import { Fault, parseArtifact, parseSpec } from './contracts.ts';
import type { Artifact, GenerationAttempt, GameSpec, GameVersion } from './contracts.ts';
import { CloudTransport, CloudOutputFailure, ProviderFailure } from './transport.ts';
import type { CodeTransport, Generator, GenerationContext, TokenUsage, ProviderMode } from './transport.ts';
import { browserCheck, checkerReady, BrowserFailure } from './browser-check.ts';
import { prepareGenerationMessages, validateDocument } from './generation.ts';
import type { PromptStyle } from './generation.ts';
import { prepareDocument } from './validation.ts';
import {generationTimeouts,LIVE_RESPONSE_TIMEOUT_MS,LIVE_JOB_TIMEOUT_MS} from './generation-timeouts.ts';
import {createHash} from 'node:crypto';
import {modelForMode} from './model-catalog.ts';

export class GenerationFailure extends Fault {
  readonly attempts: GenerationAttempt[];
  constructor(code: string, attempts: GenerationAttempt[], status=502){super(code,status);this.attempts=attempts;}
}

function confirmedGameLoopFault(code:string,feedback:string|undefined):boolean {
  if(code!=='BROWSER_GAME_LOOP_STALLED'||!feedback)return false;
  try {
    const evidence=JSON.parse(feedback) as Record<string,unknown>;
    return evidence.confirmed===true&&evidence.startAction==='confirmed'&&evidence.animationLoop==='stalled';
  } catch { return false; }
}
function confirmedCanvasTextFault(code:string,feedback:string|undefined):boolean {
  if(code!=='BROWSER_CANVAS_TEXT_CLIPPED'||!feedback)return false;
  try{const parsed=JSON.parse(feedback) as Record<string,any>,layout=parsed.canvasTextLayout??parsed;return parsed.code===code&&layout.confirmed===true&&layout.status==='FAIL'&&typeof layout.phase==='string'&&Number.isFinite(layout.viewport?.width)&&Number.isFinite(layout.viewport?.height)&&Array.isArray(layout.texts)&&layout.texts.some((item:any)=>item?.status==='CLIPPED'&&Number(item.stableSamples)>=2);}catch{return false;}
}
function confirmedCanvasUiOverlapFault(code:string,feedback:string|undefined):boolean {
  if(code!=='BROWSER_CANVAS_UI_OVERLAP'||!feedback)return false;
  try{const parsed=JSON.parse(feedback) as Record<string,any>,layout=parsed.canvasTextLayout??parsed;return parsed.code===code&&layout.confirmed===true&&layout.status==='FAIL'&&layout.overlapStatus==='FAIL'&&typeof layout.phase==='string'&&Number.isFinite(layout.viewport?.width)&&Number.isFinite(layout.viewport?.height)&&Array.isArray(layout.overlaps)&&layout.overlaps.some((item:any)=>item?.status==='CONFIRMED'&&Number(item.stableSamples)>=2&&Number(item.intersectionPixels)>=4&&Number(item.overlapRatio)>=.05&&Array.isArray(item.drawOrder)&&item.drawOrder.length===2&&Number.isFinite(item.earlierBounds?.left)&&Number.isFinite(item.laterBounds?.left))&&typeof parsed.screenshot?.captureId==='string'&&parsed.screenshot.captureId.length>0&&/^[a-f0-9]{64}$/.test(parsed.screenshot?.sha256??'');}catch{return false;}
}
function repairDiagnostic(code:string,feedback:string|undefined,details?:{validationPhase?:unknown;profileWidth?:unknown;profileHeight?:unknown}):string {
  let observed:unknown=feedback??code,viewport:string|null=null,action:string|null=null,evidence:unknown={detail:feedback??code};
  if(feedback){try{
    const parsed=JSON.parse(feedback) as Record<string,any>,layout=parsed.canvasTextLayout??parsed;evidence=parsed;
    if(parsed.diagnosis)observed=parsed.diagnosis;
    const width=layout.viewport?.width??details?.profileWidth,height=layout.viewport?.height??details?.profileHeight;
    if(typeof width==='number'&&typeof height==='number')viewport=`${width}x${height}`;
    if(Array.isArray(parsed.probes)&&parsed.probes.some((probe:any)=>probe?.tapAttempted))action='generic_canvas_tap';
  }catch{evidence={detail:feedback};}}
  if(!viewport&&typeof details?.profileWidth==='number'&&typeof details?.profileHeight==='number')viewport=`${details.profileWidth}x${details.profileHeight}`;
  const notVerified=/UNVERIFIED|TIMEOUT|INCONCLUSIVE|BROWSER_WEBGL_CONTEXT_UNAVAILABLE/.test(code);
  const gate=code.startsWith('LLM_')?'HTML':code.includes('STORAGE')||code.includes('JAVASCRIPT')||code.includes('CONSOLE')?'RUNTIME':code==='BROWSER_CANVAS_TEXT_CLIPPED'||code==='BROWSER_CANVAS_UI_OVERLAP'?'CANVAS_LAYOUT':code.includes('CANVAS')?'CANVAS_RENDER':code.includes('DOM_GAME')?'CANVAS_ONLY':code.includes('LOOP')||code.includes('INPUT')||code.includes('START')||code.includes('RESTART')||action?'GAMEPLAY':'RUNTIME';
  return JSON.stringify({status:notVerified?'NOT_VERIFIED':'REJECTED',gate,errorCode:code,viewport,action,expected:gate==='GAMEPLAY'?'The attempted game action should produce its declared state transition.':'The candidate must satisfy the protected YAPLIX browser contract.',observed,evidence,repairRequired:true});
}
type RepairContext=GenerationContext&{repairCount?:number;repairInFlight?:boolean;repairResponse?(code:string,model:string|null,usage?:TokenUsage):void};
export class GenerationEngine implements Generator {
  readonly routes: CodeTransport[]; readonly repairLimit:number; private timeout: number; private repairs: number; private active?: AbortController;
  private requestTimeout:number; private cooldowns=new Map<string,{until:number;code:string}>();
  private promptStyle:PromptStyle;
  private check: typeof browserCheck;
  private defaultMode:ProviderMode;
  private allowLlmRepair:boolean;
  constructor(routes: CodeTransport[],options:{timeoutMs?:number;requestTimeoutMs?:number;repairs?:number;allowLlmRepair?:boolean;check?:typeof browserCheck;promptStyle?:PromptStyle;defaultMode?:ProviderMode}={}){
    const requestedRepairs=options.repairs??3;
    this.defaultMode=options.defaultMode??'auto';this.routes=routes;this.timeout=options.timeoutMs??LIVE_JOB_TIMEOUT_MS;this.repairs=Math.min(requestedRepairs,3);this.check=options.check??browserCheck;
    if(!routes.length||routes.length>3||!Number.isSafeInteger(this.timeout)||this.timeout<1000||this.timeout>LIVE_JOB_TIMEOUT_MS||!Number.isSafeInteger(requestedRepairs)||requestedRepairs<0||requestedRepairs>3)throw new Fault('INVALID_LLM_CONFIGURATION');
    this.requestTimeout=options.requestTimeoutMs??Math.min(this.timeout,LIVE_RESPONSE_TIMEOUT_MS);
    this.allowLlmRepair=options.allowLlmRepair??!routes.some(r=>r instanceof CloudTransport);this.repairLimit=this.allowLlmRepair?this.repairs:0;
    this.promptStyle=options.promptStyle??'direct';if(!['spec','direct','intent'].includes(this.promptStyle))throw new Fault('INVALID_LLM_CONFIGURATION');
    if(!Number.isSafeInteger(this.requestTimeout)||this.requestTimeout<1000||this.requestTimeout>this.timeout||this.requestTimeout>LIVE_RESPONSE_TIMEOUT_MS)throw new Fault('INVALID_LLM_CONFIGURATION');
  }
  routesFor(mode:ProviderMode=this.defaultMode){
    if(!['auto','ollama-cloud','openrouter','chatgpt'].includes(mode))throw new Fault('INVALID_PROVIDER_MODE');
    // Auto is a legacy alias for Ollama; it never authorizes OpenRouter.
    const routes=this.routes.filter(r=>r.provider===(mode==='chatgpt'?'chatgpt':mode==='openrouter'?'openrouter':'ollama.com')||!['ollama.com','openrouter','chatgpt'].includes(r.provider)&&mode==='auto');
    if(!routes.length)throw new Fault('LLM_NOT_CONFIGURED',503);return routes;
  }
  get timeouts(){return{responseMs:this.requestTimeout,jobMs:this.timeout};}
  close(){this.active?.abort();}
  async readiness(){
    let routes:CodeTransport[];try{routes=this.routesFor();}catch{return{liveConfigured:false,liveReady:false,llmState:'not_configured',provider:null,model:null,browserReady:checkerReady(),fallbackConfigured:false};}
    const diagnostic=routes[0] instanceof CloudTransport?await routes[0].diagnose(AbortSignal.timeout(3000)):undefined;
    const state=diagnostic?.state??await routes[0].readiness(AbortSignal.timeout(3000));return{readinessSource:diagnostic?'models-api-get':'adapter-readiness',readinessCheckedAt:new Date().toISOString(),...(diagnostic?{network:diagnostic.network,inferenceVerified:false}:{}),liveConfigured:true,liveReady:state==='ready'&&checkerReady(),llmState:state==='ready'&&!checkerReady()?'browser_missing':state,provider:routes[0].provider,model:routes[0].model,browserReady:checkerReady(),fallbackConfigured:routes.length>1};
  }
  async generate(spec:GameSpec,previous?:GameVersion,method?:'llm_code',signal?:AbortSignal,context?:GenerationContext):Promise<Artifact>{
    parseSpec(spec,previous?1200:500);if(method!==undefined&&method!=='llm_code')throw new Fault('INVALID_REQUIRED_METHOD');
    if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw new Fault('INSECURE_TLS_CONFIGURATION',503);
    const repairBudget=Math.min(this.repairLimit,context?.repairBudget??this.repairLimit);
    const skipRepair=(code:string,reason:string,remaining=repairBudget)=>context?.trace?.('repair.eligibility',{status:'SKIPPED',errorCode:code,details:{repairNumber:1,repairBudgetRemaining:Math.max(0,remaining),blockers:[reason]}});
    if(this.check===browserCheck&&!checkerReady()){context?.trace?.('browser.launch.failed',{status:'NOT_VERIFIED',errorCode:'BROWSER_INSTALL_REQUIRED',details:{browserReady:false,sandboxEnabled:true}});skipRepair('BROWSER_INSTALL_REQUIRED','BROWSER_INFRASTRUCTURE_FAILURE');throw new Fault('BROWSER_INSTALL_REQUIRED',503);}
    if(this.active)throw new Fault('LLM_BUSY',409);
    const routes=this.routesFor(context?.providerMode);
    const controller=new AbortController();this.active=controller;const timer=setTimeout(()=>controller.abort(),this.timeout),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    const attempts:GenerationAttempt[]=[];const started=performance.now();
    try{
      const repairContext=context as RepairContext|undefined;
      let repairCount=repairContext?.repairCount??(context?.repairUsed?1:0),repairInFlight=repairContext?.repairInFlight??Boolean(context?.repairUsed);
      let recoveryRoute:CodeTransport|undefined;
      let lastCode='LLM_GENERATION_FAILED',partial=context?.checkpoint??'',recoveryIssue='';
      if(partial&&(!context?.checkpointOrigin||!routes.some(r=>r.provider===context.checkpointOrigin!.provider&&r.model===context.checkpointOrigin!.requestedModel))){
        context?.preserveOriginal?.(partial);
        context?.validation?.({level:'NOT_VERIFIED',code:'CHECKPOINT_ORIGIN_UNAVAILABLE',phase:'recovery',feedback:'The original checkpoint provider is unknown or no longer configured. The draft is preserved; start a new request to use another provider.'});
        throw new Fault('CHECKPOINT_ORIGIN_UNAVAILABLE',409);
      }
      const checkDocument=async(raw:string)=>{
        context?.stage('validating');
        context?.preserveOriginal?.(raw);
        let browserBegan:number|undefined;const formatBegan=performance.now();
        try{
          const prepared=prepareDocument(raw);
          if(prepared.repair){context?.preserveOriginal?.(raw);context?.validation?.({level:'NOT_VERIFIED',code:prepared.repair,phase:'format',feedback:'Format repair requires full revalidation.'},prepared.repair);}
          context?.trace?.('html.extracted',{outputBytes:Buffer.byteLength(prepared.html),durationMs:Math.round(performance.now()-formatBegan),next:'html-validation',details:{htmlBytes:Buffer.byteLength(prepared.html),htmlSha256:createHash('sha256').update(prepared.html).digest('hex')}});
          const issues=validateDocument(prepared.html);if(issues.length){context?.trace?.('html.validated',{status:'FAIL',errorCode:'LLM_UNSAFE_ARTIFACT',durationMs:Math.round(performance.now()-formatBegan),details:{blockers:issues.slice(0,16)}});throw new BrowserFailure('LLM_UNSAFE_ARTIFACT',issues.join(', '));}
          context?.trace?.('html.validated',{status:'PASS',durationMs:Math.round(performance.now()-formatBegan),next:'browser'});browserBegan=performance.now();context?.trace?.('browser.started',{status:'STARTED'});
          const evidence=await this.check(prepared.html,controller.signal,{trace:context?.trace,saveSnapshot:context?.saveBrowserSnapshot});
          if(controller.signal.aborted)throw new Fault('REQUEST_CANCELLED',499);
          context?.trace?.('browser.validation_completed',{durationMs:Math.round(performance.now()-browserBegan),next:'save'});
          context?.validation?.({level:'VERIFIED',code:'BROWSER_CHECK_PASSED',phase:'short-browser-check',feedback:'Startup/runtime checked; per-aspect gameplay evidence is separate.'});
          return{code:prepared.html,evidence};
        }catch(error){
          context?.preserveOriginal?.(raw);
          const code=error instanceof Fault?error.code:'BROWSER_STARTUP_FAILED';
          context?.trace?.(/JAVASCRIPT_EXCEPTION|CONSOLE_ERROR/.test(code)?'browser.runtime_error':code.startsWith('BROWSER_')?'browser.validation_completed':'html.validated',{status:/TIMEOUT|INCONCLUSIVE|UNAVAILABLE|INSTALL_REQUIRED/.test(code)?'NOT_VERIFIED':'FAIL',errorCode:code,durationMs:Math.round(performance.now()-(browserBegan??formatBegan)),validationPhase:(error as {validationPhase?:string})?.validationPhase,profileWidth:(error as {profileWidth?:number})?.profileWidth,profileHeight:(error as {profileHeight?:number})?.profileHeight,next:'needs_attention'});
          const feedback=error instanceof BrowserFailure?error.feedback:(error instanceof Fault&&(error as Fault&{feedback?:string}).feedback)||code;
          context?.validation?.({level:/TIMEOUT|CANCELLED|SANDBOX|INSTALL_REQUIRED|STARTUP_FAILED|INCONCLUSIVE|^BROWSER_WEBGL_CONTEXT_UNAVAILABLE$|^BROWSER_CANVAS_(?:RENDER|ACTIVITY|DOM)_UNVERIFIED$/.test(code)?'NOT_VERIFIED':'FAILED',code,phase:'validation',feedback});
          throw error;
        }
      };
      if(partial&&context?.checkpointOrigin){
        const origin=context.checkpointOrigin,route=routes.find(r=>r.provider===origin.provider&&r.model===origin.requestedModel);
        if(route){let complete='';try{complete=prepareDocument(partial).html;}catch{/* Incomplete draft needs controlled rewriting. */}
          if(complete){
            context.stage('validating');
            try{const checked=await checkDocument(partial),evidence=checked.evidence;complete=checked.code;if(controller.signal.aborted)throw new Fault('REQUEST_CANCELLED',499);const attempt:GenerationAttempt={route:route.route,provider:origin.provider,requestedModel:origin.requestedModel,model:origin.model,outcome:'accepted',errorCode:null,elapsedMs:Math.round(performance.now()-started),requestMs:0,validationMs:Math.round(performance.now()-started)};context.attempt(attempt);
              return parseArtifact({html:complete,method:'llm_code',provider:origin.provider,model:origin.model,generationStatus:'succeeded',validationStatus:'passed',generation:{attempts:[attempt],fallback:route!==routes[0],elapsedMs:Math.round(performance.now()-started),browser:evidence}});
            }catch(error){
              if(controller.signal.aborted)throw error;
              const feedback=error instanceof BrowserFailure?error.feedback:error instanceof Fault?(error as Fault&{feedback?:string}).feedback:undefined;
              recoveryIssue=error instanceof BrowserFailure?error.code+': '+error.feedback:error instanceof Fault?error.code:'BROWSER_STARTUP_FAILED';
              const confirmedCanvasText=error instanceof Fault&&confirmedCanvasTextFault(error.code,feedback),confirmedCanvasOverlap=error instanceof Fault&&confirmedCanvasUiOverlapFault(error.code,feedback);
              const canvasLayoutFault=error instanceof Fault&&['BROWSER_CANVAS_TEXT_CLIPPED','BROWSER_CANVAS_UI_OVERLAP'].includes(error.code),confirmedCanvasLayout=confirmedCanvasText||confirmedCanvasOverlap;
              const unsupported=error instanceof Fault&&(/^BROWSER_CANVAS_|^BROWSER_DOM_GAME_WORLD/.test(error.code)&&!confirmedCanvasLayout||error.code==='BROWSER_DOM_GAME_UI'&&route.provider!=='ollama.com');
              const ambiguous=error instanceof Fault&&/TIMEOUT|SANDBOX|INSTALL_REQUIRED|TEMP_PATH_TOO_LONG|INCONCLUSIVE|^INVALID_GENERATION_METADATA$/.test(error.code);
              const blocker=route.provider==='openrouter'?'PROVIDER_REPAIR_DISABLED':!this.allowLlmRepair?'REPAIR_DISABLED':repairCount>=repairBudget?'REPAIR_BUDGET_EXHAUSTED':repairInFlight?'REPAIR_ALREADY_IN_FLIGHT':ambiguous?'AMBIGUOUS_OR_INFRASTRUCTURE_EVIDENCE':canvasLayoutFault&&!confirmedCanvasLayout?'CANVAS_LAYOUT_NOT_CONFIRMED':unsupported?'UNSUPPORTED_OR_UNVERIFIED_DEFECT':'';
              if(error instanceof Fault&&['BROWSER_SANDBOX_UNAVAILABLE','BROWSER_SANDBOX_CONFIGURATION','BROWSER_INSTALL_REQUIRED','BROWSER_TEMP_PATH_TOO_LONG'].includes(error.code))skipRepair(error.code,'BROWSER_INFRASTRUCTURE_FAILURE',repairBudget-repairCount);
              if(blocker){if(canvasLayoutFault||unsupported)context?.trace?.('repair.eligibility',{status:'SKIPPED',errorCode:error instanceof Fault?error.code:'BROWSER_CHECK_FAILED',details:{repairNumber:repairCount+1,repairBudgetRemaining:Math.max(0,repairBudget-repairCount),blockers:[blocker]}});throw error;}
              context?.trace?.('repair.eligibility',{status:'PASS',errorCode:error instanceof Fault?error.code:'BROWSER_CHECK_FAILED',details:{repairNumber:repairCount+1,repairBudgetRemaining:Math.max(0,repairBudget-repairCount)}});
              context?.trace?.('repair.started',{status:'STARTED',details:{repairNumber:repairCount+1,repairBudgetRemaining:Math.max(0,repairBudget-repairCount)}});recoveryRoute=route;
            }
          }else{
            context.preserveOriginal?.(partial);
            const manualRouterRetry=route.provider==='openrouter'&&context.manualContinuation===true&&repairBudget===0&&repairCount===0&&!repairInFlight;
            if(route.provider==='openrouter'&&!context.manualContinuation||!this.allowLlmRepair||repairCount>=repairBudget&&!manualRouterRetry||repairInFlight)throw new Fault(context.validationFailure??'LLM_INVALID_HTML',502);
            if(manualRouterRetry)partial=''; // Explicit OpenRouter Continue starts a fresh request; OpenRouter repair remains disabled.
            else recoveryRoute=route;
          }
        }
      }
      // Preserve a useful checkpoint, but discard known broken mechanics when
      // moving to the next route. Never traverse the provider list twice.
      const freshIssues=['BROWSER_INPUT_NO_EFFECT','BROWSER_START_CONTROL','BROWSER_MOBILE_LAYOUT','BROWSER_GAME_AREA','BROWSER_HORIZONTAL_OVERFLOW','BROWSER_INSTANT_END','BROWSER_AUTOSTART','BROWSER_DUPLICATE_START','BROWSER_EVENT_ORDER','LLM_INVALID_HTML','LLM_UNSAFE_ARTIFACT','LLM_INVALID_RESPONSE','LLM_OUTPUT_TRUNCATED'];
      for(const route of recoveryRoute?[recoveryRoute]:routes){
        const stored=context?.cooldowns?.[route.provider+'/'+route.model];if(stored&&stored.until>Date.now())this.cooldowns.set(route.provider+'/'+route.model,stored);
        const key=route.provider+'/'+route.model,cooldown=this.cooldowns.get(key);
        if(context?.blockedRoutes?.includes(key)){lastCode='JOB_RESTART_UNCERTAIN';context?.trace?.('repair.eligibility',{status:'SKIPPED',errorCode:lastCode,details:{repairNumber:repairCount+1,repairBudgetRemaining:Math.max(0,repairBudget-repairCount),blockers:['UNKNOWN_POST_OUTCOME']}});continue;}
        if(cooldown&&cooldown.until>Date.now()){lastCode=cooldown.code;if(Number.isFinite(cooldown.until))context?.retryAt?.(cooldown.until);continue;}
        const partialResumable=Boolean(partial)&&!freshIssues.includes(lastCode);
        const prepared=prepareGenerationMessages(spec,previous,this.promptStyle),messages=prepared.messages,promptJson=JSON.stringify(messages),vocab=prepared.vocabulary;context?.trace?.('provider.selected',{provider:route.provider,requestedModel:route.model});context?.trace?.('prompt.prepared',{status:'PASS',inputBytes:Buffer.byteLength(promptJson),next:'request',details:{promptBytes:Buffer.byteLength(promptJson),promptSha256:createHash('sha256').update(promptJson).digest('hex'),promptStyle:this.promptStyle,requestBudget:context?.maxCalls??4,repairBudget,...vocab}});context?.captureMessages?.(messages);
        if(partial&&partialResumable)messages.push({role:'assistant',content:partial},{role:'user',content:'Recover this draft using the original requirements. Return one complete concise HTML document, not a continuation fragment. Preserve working mechanics. Never concatenate unverified fragments. '+recoveryIssue});
        const checkpointRepair=recoveryRoute===route,requestLimit=checkpointRepair?repairBudget-repairCount:1+repairBudget;
        for(let repair=0;repair<requestLimit;repair++){
          const isRepair=checkpointRepair||repair>0;
          if(isRepair){if(repairCount>=repairBudget||repairInFlight)throw new GenerationFailure(context?.validationFailure??'LLM_REPAIR_LIMIT',attempts);context?.claimRepair?.();repairCount++;repairInFlight=true;}
          if(context&&attempts.length>=(context.maxCalls??6)){context.trace?.('repair.eligibility',{status:'SKIPPED',errorCode:'JOB_ATTEMPT_LIMIT',details:{repairNumber:repairCount+1,repairBudgetRemaining:Math.max(0,repairBudget-repairCount),blockers:['LOCAL_POST_BUDGET_EXHAUSTED']}});throw new GenerationFailure(attempts.at(-1)?.errorCode??'JOB_ATTEMPT_LIMIT',attempts,409);}
          const begin=performance.now();let actual:string|null=null,code='',requestMs=0,validationMs=0;let tokens:TokenUsage={};
          const requestController=new AbortController(),requestTimer=setTimeout(()=>requestController.abort(),this.requestTimeout);
          const requestSignal=AbortSignal.any([controller.signal,requestController.signal]);
          try{
            context?.stage(isRepair?'repairing':'generating');if(!route.observesDispatch)context?.dispatch(route);
            const transportContext=context?{...context,partial:(value:string,model:string|null,usage?:TokenUsage)=>{if(value)partial=value;if(model)actual=model;if(usage)tokens={...tokens,...usage};context.partial(value,model,usage);}}:undefined;
            const response=await route.complete(messages,requestSignal,transportContext);clearTimeout(requestTimer);requestMs=Math.round(performance.now()-begin);actual=response.model;tokens={...(response.outputTokens===undefined?{}:{outputTokens:response.outputTokens}),...(response.reasoningTokens===undefined?{}:{reasoningTokens:response.reasoningTokens})};partial=response.code;if(isRepair){repairContext?.repairResponse?.(partial,actual,tokens);repairInFlight=false;}else context?.partial(partial,actual,tokens);
            const checkBegan=performance.now();let checked;try{checked=await checkDocument(response.code);}finally{validationMs=Math.round(performance.now()-checkBegan);}code=checked.code;const evidence=checked.evidence;if(isRepair)context?.trace?.('repair.completed',{status:'PASS',durationMs:validationMs,next:'save',details:{repairNumber:repairCount,htmlBytes:Buffer.byteLength(code),htmlSha256:createHash('sha256').update(code).digest('hex')}});
            if(controller.signal.aborted)throw new Fault('REQUEST_CANCELLED',499);
            attempts.push({route:route.route,provider:route.provider,requestedModel:route.model,model:actual,outcome:'accepted',errorCode:null,elapsedMs:Math.round(performance.now()-begin),requestMs,validationMs,...tokens});context?.attempt(attempts.at(-1)!);
            return parseArtifact({html:code,method:'llm_code',provider:route.provider,model:actual,generationStatus:'succeeded',validationStatus:'passed',generation:{attempts,fallback:route!==routes[0],elapsedMs:Math.round(performance.now()-started),browser:evidence}});
          }catch(error){
            if(isRepair)context?.trace?.('repair.completed',{status:'FAIL',errorCode:error instanceof Fault?error.code:'LLM_NETWORK_OR_RESPONSE',details:{repairNumber:repairCount,htmlBytes:code?Buffer.byteLength(code):0,htmlSha256:code?createHash('sha256').update(code).digest('hex'):''}});
            if(controller.signal.aborted){attempts.push({route:route.route,provider:route.provider,requestedModel:route.model,model:actual,outcome:'failed',errorCode:signal?.aborted?'REQUEST_CANCELLED':'LLM_TIMEOUT',elapsedMs:Math.round(performance.now()-begin),requestMs:requestMs||Math.round(performance.now()-begin),validationMs,...tokens});context?.attempt(attempts.at(-1)!);throw error;}
            if(error instanceof ProviderFailure){actual=error.actualModel;code=error.partial;tokens=error.usage;if(code)partial=code;context?.partial(code,actual,tokens);if(error.retryAt)context?.retryAt?.(error.retryAt);}
            // Extraction can throw before assigning code. Repair still needs the
            // confirmed raw response, including an incomplete HTML document.
            if(!code&&actual&&partial)code=partial;
            lastCode=requestController.signal.aborted?'LLM_TIMEOUT':error instanceof Fault?error.code:'LLM_NETWORK_OR_RESPONSE';
            attempts.push({route:route.route,provider:route.provider,requestedModel:route.model,model:actual,outcome:actual?'rejected':'failed',errorCode:lastCode,elapsedMs:Math.round(performance.now()-begin),requestMs:requestMs||Math.round(performance.now()-begin),validationMs,...tokens});context?.attempt(attempts.at(-1)!);
            if(['LLM_QUOTA','LLM_AUTH','LLM_MODEL_NOT_FOUND','FREE_MODEL_REQUIRED','LLM_CONTEXT_LIMIT','LLM_OUTPUT_BUDGET_TOO_SMALL'].includes(lastCode)){
              context?.trace?.('repair.eligibility',{status:'SKIPPED',errorCode:lastCode,details:{repairNumber:repairCount+1,repairBudgetRemaining:Math.max(0,repairBudget-repairCount),blockers:['PROVIDER_OR_REQUEST_FAILURE']}});
              const until=Date.now()+900000;this.cooldowns.set(key,{until,code:lastCode});context?.cooldownRoute?.(route,until,lastCode);context?.blockRoute?.(route,lastCode);break;
            }
            if(lastCode==='LLM_RATE_LIMIT'){const until=error instanceof ProviderFailure&&error.retryAt?error.retryAt:Date.now()+60000;context?.trace?.('repair.eligibility',{status:'SKIPPED',errorCode:lastCode,details:{repairNumber:repairCount+1,repairBudgetRemaining:Math.max(0,repairBudget-repairCount),blockers:['PROVIDER_RATE_LIMIT']}});this.cooldowns.set(key,{until,code:lastCode});context?.cooldownRoute?.(route,until,lastCode);context?.retryAt?.(until);break;}
            if(context&&['RATE_LIMIT','JOB_ATTEMPT_LIMIT'].includes(lastCode)){context.trace?.('repair.eligibility',{status:'SKIPPED',errorCode:lastCode,details:{repairNumber:repairCount+1,repairBudgetRemaining:Math.max(0,repairBudget-repairCount),blockers:['LOCAL_POST_BUDGET_OR_RATE_LIMIT']}});throw new GenerationFailure(lastCode,attempts,429);}
            if(context&&['LLM_DNS','LLM_TCP_CONNECTION','LLM_PROXY_CONNECTION','LLM_NETWORK_UNAVAILABLE','LLM_RESPONSE_TIMEOUT','LLM_TIMEOUT','LLM_CONNECTION_INTERRUPTED','LLM_STREAM_ERROR'].includes(lastCode)){
              const safePreDispatchFailure=error instanceof ProviderFailure&&error.diagnostic?.stage==='connect'&&['LLM_DNS','LLM_TCP_CONNECTION'].includes(lastCode);
              if(safePreDispatchFailure){context.trace?.('repair.eligibility',{status:'SKIPPED',errorCode:lastCode,details:{repairNumber:repairCount+1,repairBudgetRemaining:Math.max(0,repairBudget-repairCount),blockers:['PRE_DISPATCH_NETWORK_FAILURE'],networkStage:'connect'}});break;}
              // Unknown remote billing must not cause unconditional duplicate
              // requests. A separate explicitly configured route can recover.
              context.blockRoute?.(route,lastCode);
              context.trace?.('repair.eligibility',{status:'SKIPPED',errorCode:lastCode,details:{repairNumber:repairCount+1,repairBudgetRemaining:Math.max(0,repairBudget-repairCount),blockers:['UNKNOWN_POST_OUTCOME']} });
              const until=Date.now()+5000;this.cooldowns.set(key,{until,code:lastCode});context.cooldownRoute?.(route,until,lastCode);context.retryAt?.(until);break;
            }
            // A local contract failure cannot be repaired by another provider.
            const rawBrowserFeedback=error instanceof BrowserFailure?error.feedback:error instanceof Fault?(error as Fault&{feedback?:string}).feedback:undefined;
            const confirmedCanvasText=confirmedCanvasTextFault(lastCode,rawBrowserFeedback),confirmedCanvasOverlap=confirmedCanvasUiOverlapFault(lastCode,rawBrowserFeedback);
            const canvasLayoutFault=['BROWSER_CANVAS_TEXT_CLIPPED','BROWSER_CANVAS_UI_OVERLAP'].includes(lastCode),confirmedCanvasLayout=confirmedCanvasText||confirmedCanvasOverlap;
            const unsupported=lastCode==='INVALID_GENERATION_METADATA'||/^BROWSER_(?:CANVAS_|WEBGL_CONTEXT_UNAVAILABLE|DOM_GAME_WORLD)/.test(lastCode)&&!confirmedCanvasLayout||lastCode==='BROWSER_DOM_GAME_UI'&&route.provider!=='ollama.com';
            if(unsupported){if(canvasLayoutFault||/^BROWSER_CANVAS_|^BROWSER_DOM_GAME_WORLD/.test(lastCode))context?.trace?.('repair.eligibility',{status:'SKIPPED',errorCode:lastCode,details:{repairNumber:repairCount+1,repairBudgetRemaining:Math.max(0,repairBudget-repairCount),blockers:[canvasLayoutFault?'CANVAS_LAYOUT_NOT_CONFIRMED':'UNSUPPORTED_OR_UNVERIFIED_DEFECT']}});throw new GenerationFailure(lastCode,attempts);}
            if(['BROWSER_SANDBOX_UNAVAILABLE','BROWSER_SANDBOX_CONFIGURATION','BROWSER_INSTALL_REQUIRED','BROWSER_TEMP_PATH_TOO_LONG'].includes(lastCode)){skipRepair(lastCode,'BROWSER_INFRASTRUCTURE_FAILURE',repairBudget-repairCount);throw new GenerationFailure(lastCode,attempts,503);}
            const repairable=error instanceof BrowserFailure||/^(?:BROWSER_|JAVASCRIPT_EXCEPTION|LLM_INVALID_HTML|LLM_UNSAFE_ARTIFACT|LLM_OUTPUT_TRUNCATED)/.test(lastCode);
            const loopFeedback=error instanceof BrowserFailure?error.feedback:error instanceof Fault?(error as Fault&{feedback?:string}).feedback:undefined;
            const ineligible=!actual?'NO_MODEL_RESPONSE':!repairable?'NOT_REPAIRABLE':route.provider==='openrouter'?'PROVIDER_REPAIR_DISABLED':!this.allowLlmRepair?'REPAIR_DISABLED':repairCount>=repairBudget?'REPAIR_BUDGET_EXHAUSTED':repairInFlight?'REPAIR_ALREADY_IN_FLIGHT':/BROWSER_TIMEOUT|INCONCLUSIVE/.test(lastCode)?'AMBIGUOUS_BROWSER_EVIDENCE':lastCode==='BROWSER_DOM_GAME_UI'&&route.provider!=='ollama.com'?'PROVIDER_REPAIR_DISABLED':'';
            if(ineligible){context?.trace?.('repair.eligibility',{status:'SKIPPED',errorCode:lastCode,details:{repairNumber:repairCount+1,repairBudgetRemaining:Math.max(0,repairBudget-repairCount),blockers:[ineligible]}});if(ineligible==='NO_MODEL_RESPONSE'||ineligible==='NOT_REPAIRABLE')break;throw new GenerationFailure(lastCode,attempts);}
            const loopFault=Boolean(lastCode==='BROWSER_GAME_LOOP_STALLED'&&route.provider==='ollama.com'&&confirmedGameLoopFault(lastCode,loopFeedback));
            if(lastCode==='BROWSER_GAME_LOOP_STALLED'&&!loopFault){context?.trace?.('repair.eligibility',{status:'SKIPPED',errorCode:lastCode,details:{repairNumber:repairCount+1,repairBudgetRemaining:Math.max(0,repairBudget-repairCount),blockers:['LOOP_FAULT_UNCONFIRMED']}});throw new GenerationFailure(lastCode,attempts);}
            context?.trace?.('repair.eligibility',{status:'PASS',errorCode:lastCode,details:{repairNumber:repairCount+1,repairBudgetRemaining:Math.max(0,repairBudget-repairCount)}});
            context?.preserveOriginal?.(partial);context?.trace?.('repair.started',{status:'STARTED',errorCode:lastCode,details:{repairNumber:repairCount+1,repairBudgetRemaining:Math.max(0,repairBudget-repairCount)}});
            const browserFeedback=repairDiagnostic(lastCode,rawBrowserFeedback,error instanceof Fault?error as Fault&{validationPhase?:unknown;profileWidth?:unknown;profileHeight?:unknown}:undefined);
            const storageRepair=lastCode==='BROWSER_STORAGE_ACCESS_FORBIDDEN'?' Remove every read, write, and dependency on browser storage APIs; do not merely catch or suppress the exception. Replace saved values with ordinary JavaScript in-memory state and preserve all game mechanics.':'';
            const domUiRepair=lastCode==='BROWSER_DOM_GAME_UI'?' The protected Canvas checker found visible game interface implemented in DOM/CSS. Convert every visible instruction, control, menu, HUD, score and game-state screen into Canvas rendering with Canvas hitboxes; remove the visible DOM game UI instead of hiding it. Preserve the actual game mechanics and all explicit user rules. Do not weaken the checker or security rules.':'';
            const loopRepair=loopFault?' The checker confirmed that the Start action entered the active state but the gameplay animation loop stalled. Repair the Start/Pause/Restart lifecycle and requestAnimationFrame scheduling; keep one loop alive while waiting or paused, resume the same session, and restart from reset state without duplicating loops. Do not add artificial motion.':'';
            const canvasLayoutRepair=confirmedCanvasOverlap?' The checker confirmed that separate visible Canvas text draws obscure shared glyph pixels. Reposition or reflow the listed UI elements so essential labels and controls remain independently readable at the supplied viewport; use the recorded glyph bounds, shared-pixel count, draw order and screenshot evidence. Do not infer button hitboxes from rectangles. Preserve the full game mechanics and the original request.':confirmedCanvasText?' The checker repeatedly measured Canvas 2D glyph bounds outside the backing bitmap. Use the supplied viewport, transform, alignment, baseline and clipped-edge measurements to keep every visible label/button fully within the Canvas across the checked sizes. Preserve the controls and gameplay; adjust responsive layout, wrapping or font size without changing core mechanics. The diagnostic is confirmed only for the listed Canvas text draws.':'';
            messages.push({role:'assistant',content:code||'No complete HTML was returned.'},{role:'user',content:'Browser/static verification rejected the result: '+lastCode+'. '+(browserFeedback??(error instanceof CloudOutputFailure?'The output token budget was exhausted. Return complete HTML within the available token budget, without explanations; preserve all requested mechanics.':''))+' '+domUiRepair+' '+storageRepair+' '+loopRepair+' '+canvasLayoutRepair+' '+validateDocument(code).join(', ')+'. Fix this defect in the complete HTML, preserve the original request and all working mechanics. Do not start automatically, restart the state on resume, or duplicate lifecycle events. Original idea and requirements: '+JSON.stringify(spec)});
          }finally{clearTimeout(requestTimer);}
        }
        if(repairCount>0)throw new GenerationFailure(lastCode,attempts);
      }
      throw new GenerationFailure(lastCode,attempts);
    }catch(error){if(controller.signal.aborted)throw new GenerationFailure(signal?.aborted?'REQUEST_CANCELLED':'LLM_TIMEOUT',attempts,signal?.aborted?499:504);if(error instanceof GenerationFailure)throw error;throw new GenerationFailure(error instanceof Fault?error.code:'LLM_NETWORK_OR_RESPONSE',attempts);}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.abort();this.active=undefined;}
  }
}
export function configuredGenerator(env:NodeJS.ProcessEnv=process.env,chatgpt?:CodeTransport):GenerationEngine|undefined{
  const selection=env.LIVE_PROVIDER??'auto';if(selection==='none')return;
  // Old model/fallback values cannot dispatch arbitrary routes. Keys stay local;
  // the only production models and endpoints are fixed by MICRO-019.
  const selected=selection==='cloud'?'openrouter':selection==='ollama'?'auto':selection;
  if(!['auto','ollama-cloud','openrouter','chatgpt'].includes(selected))throw new Fault('INVALID_LIVE_PROVIDER');
  if(env.CLOUD_BASE_URL&&env.CLOUD_BASE_URL!=='https://openrouter.ai/api/v1')throw new Fault('FREE_MODEL_REQUIRED');
  const routes:CodeTransport[]=[];
  if(env.OLLAMA_CLOUD_API_KEY?.trim())routes.push(new CloudTransport({networkEnv:()=>env,base:'https://ollama.com/v1',key:env.OLLAMA_CLOUD_API_KEY,model:modelForMode('ollama-cloud')!.model,maxTokens:Number(env.LLM_MAX_TOKENS??12000),temperature:env.LLM_TEMPERATURE?Number(env.LLM_TEMPERATURE):undefined,tokenField:(env.LLM_TOKEN_FIELD??'max_tokens') as 'max_tokens'|'max_completion_tokens'}));
  if(env.CLOUD_API_KEY?.trim())routes.push(new CloudTransport({networkEnv:()=>env,base:'https://openrouter.ai/api/v1',key:env.CLOUD_API_KEY,model:modelForMode('openrouter')!.model,route:routes.length?'secondary':'primary',maxTokens:Number(env.LLM_MAX_TOKENS??12000),temperature:env.LLM_TEMPERATURE?Number(env.LLM_TEMPERATURE):undefined,tokenField:(env.LLM_TOKEN_FIELD??'max_tokens') as 'max_tokens'|'max_completion_tokens'}));
  if(chatgpt)routes.push(chatgpt);
  if(!routes.length)return;
  const budgets=generationTimeouts(env);
  const automaticRepair=env.LLM_AUTO_REPAIR===undefined||env.LLM_AUTO_REPAIR==='1';
  return new GenerationEngine(routes,{allowLlmRepair:automaticRepair,defaultMode:selected as ProviderMode,timeoutMs:budgets.jobMs,requestTimeoutMs:budgets.responseMs,repairs:Number(env.LLM_REPAIRS??3),promptStyle:(env.LLM_PROMPT_STYLE??'direct') as PromptStyle});
}
