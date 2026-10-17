import { Fault, parseArtifact, parseSpec } from './contracts.ts';
import type { Artifact, GenerationAttempt, GameSpec, GameVersion } from './contracts.ts';
import { CloudTransport, CloudOutputFailure, ProviderFailure } from './transport.ts';
import type { CodeTransport, Generator, GenerationContext, TokenUsage, ProviderMode } from './transport.ts';
import { browserCheck, checkerReady, BrowserFailure } from './browser-check.ts';
import { generationMessages, validateDocument } from './generation.ts';
import { prepareDocument, validationOutcome } from './validation.ts';

export class GenerationFailure extends Fault {
  readonly attempts: GenerationAttempt[];
  constructor(code: string, attempts: GenerationAttempt[], status=502){super(code,status);this.attempts=attempts;}
}
export class GenerationEngine implements Generator {
  readonly routes: CodeTransport[]; private timeout: number; private repairs: number; private active?: AbortController;
  private requestTimeout:number; private cooldowns=new Map<string,{until:number;code:string}>();
  private promptStyle:'spec'|'direct';
  private check: typeof browserCheck;
  private defaultMode:ProviderMode;
  private allowLlmRepair:boolean;
  constructor(routes: CodeTransport[],options:{timeoutMs?:number;requestTimeoutMs?:number;repairs?:number;allowLlmRepair?:boolean;check?:typeof browserCheck;promptStyle?:'spec'|'direct';defaultMode?:ProviderMode}={}){
    this.defaultMode=options.defaultMode??'auto';this.routes=routes;this.timeout=options.timeoutMs??180000;this.repairs=options.repairs??1;this.check=options.check??browserCheck;
    if(!routes.length||routes.length>3||!Number.isSafeInteger(this.timeout)||this.timeout<1000||this.timeout>300000||!Number.isSafeInteger(this.repairs)||this.repairs<0||this.repairs>2)throw new Fault('INVALID_LLM_CONFIGURATION');
    this.requestTimeout=options.requestTimeoutMs??Math.min(this.timeout,60000);
    this.allowLlmRepair=options.allowLlmRepair??!routes.some(r=>r instanceof CloudTransport);
    this.promptStyle=options.promptStyle??'direct';if(!['spec','direct'].includes(this.promptStyle))throw new Fault('INVALID_LLM_CONFIGURATION');
    if(!Number.isSafeInteger(this.requestTimeout)||this.requestTimeout<1000||this.requestTimeout>this.timeout)throw new Fault('INVALID_LLM_CONFIGURATION');
  }
  routesFor(mode:ProviderMode=this.defaultMode){
    if(!['auto','ollama-cloud','openrouter'].includes(mode))throw new Fault('INVALID_PROVIDER_MODE');
    // Auto is a legacy alias for Ollama; it never authorizes OpenRouter.
    const routes=this.routes.filter(r=>r.provider===(mode==='openrouter'?'openrouter':'ollama.com')||!['ollama.com','openrouter'].includes(r.provider)&&mode==='auto');
    if(!routes.length)throw new Fault('LLM_NOT_CONFIGURED',503);return routes;
  }
  close(){this.active?.abort();}
  async readiness(){
    let routes:CodeTransport[];try{routes=this.routesFor();}catch{return{liveConfigured:true,liveReady:false,llmState:'not_configured',provider:null,model:null,browserReady:checkerReady(),fallbackConfigured:false};}
    const diagnostic=routes[0] instanceof CloudTransport?await routes[0].diagnose(AbortSignal.timeout(3000)):undefined;
    const state=diagnostic?.state??await routes[0].readiness(AbortSignal.timeout(3000));return{readinessSource:diagnostic?'models-api-get':'adapter-readiness',readinessCheckedAt:new Date().toISOString(),...(diagnostic?{network:diagnostic.network,inferenceVerified:false}:{}),liveConfigured:true,liveReady:state==='ready'&&checkerReady(),llmState:state==='ready'&&!checkerReady()?'browser_missing':state,provider:routes[0].provider,model:routes[0].model,browserReady:checkerReady(),fallbackConfigured:routes.length>1};
  }
  async generate(spec:GameSpec,previous?:GameVersion,method?:'llm_code',signal?:AbortSignal,context?:GenerationContext):Promise<Artifact>{
    parseSpec(spec);if(method!==undefined&&method!=='llm_code')throw new Fault('INVALID_REQUIRED_METHOD');
    if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw new Fault('INSECURE_TLS_CONFIGURATION',503);
    if(this.check===browserCheck&&!checkerReady())throw new Fault('BROWSER_INSTALL_REQUIRED',503);
    if(this.active)throw new Fault('LLM_BUSY',409);
    const routes=this.routesFor(context?.providerMode);
    const controller=new AbortController();this.active=controller;const timer=setTimeout(()=>controller.abort(),this.timeout),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    const attempts:GenerationAttempt[]=[];const started=performance.now();
    try{
      const priorRepairUsed=context?.repairUsed??false;
      let recoveryRoute:CodeTransport|undefined;
      let lastCode='LLM_GENERATION_FAILED',partial=context?.checkpoint??'',recoveryIssue='',repairUsed=priorRepairUsed;
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
          context?.trace?.('html.extracted',{outputBytes:Buffer.byteLength(prepared.html),durationMs:Math.round(performance.now()-formatBegan),next:'html-validation'});
          const issues=validateDocument(prepared.html);if(issues.length)throw new BrowserFailure('LLM_UNSAFE_ARTIFACT',issues.join(', '));
          context?.trace?.('html.validated',{durationMs:Math.round(performance.now()-formatBegan),next:'browser'});browserBegan=performance.now();context?.trace?.('browser.started');
          const evidence=await this.check(prepared.html,controller.signal);
          if(controller.signal.aborted)throw new Fault('REQUEST_CANCELLED',499);
          context?.trace?.('browser.validation_completed',{durationMs:Math.round(performance.now()-browserBegan),next:'save'});
          context?.validation?.({level:'VERIFIED',outcome:validationOutcome(undefined,evidence.checks),code:'BROWSER_CHECK_PASSED',phase:'short-browser-check',feedback:'Startup/runtime checked; per-aspect gameplay evidence is separate.'});
          return{code:prepared.html,evidence};
        }catch(error){
          context?.preserveOriginal?.(raw);
          const code=error instanceof Fault?error.code:'BROWSER_STARTUP_FAILED';
          context?.trace?.(/JAVASCRIPT_EXCEPTION|CONSOLE_ERROR/.test(code)?'browser.runtime_error':code.startsWith('BROWSER_')?'browser.validation_completed':'html.validated',{errorCode:code,durationMs:Math.round(performance.now()-(browserBegan??formatBegan)),validationPhase:(error as {validationPhase?:string})?.validationPhase,profileWidth:(error as {profileWidth?:number})?.profileWidth,next:'needs_attention'});
          const outcome=validationOutcome(code);
          context?.validation?.({level:outcome==='CHECKER_ERROR'?'NOT_VERIFIED':outcome,outcome,code,phase:(error as {validationPhase?:string})?.validationPhase??'validation',feedback:error instanceof BrowserFailure?error.feedback:code});
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
            }catch(error){if(controller.signal.aborted)throw error;recoveryIssue=error instanceof BrowserFailure?error.code+': '+error.feedback:error instanceof Fault?error.code:'BROWSER_STARTUP_FAILED';if(route.provider==='openrouter'||!this.allowLlmRepair||this.repairs===0||repairUsed||!(error instanceof Fault)||validationOutcome(error.code)==='CHECKER_ERROR'||(/TIMEOUT|INCONCLUSIVE/.test(error.code)))throw error;
              context?.trace?.('repair.started');context?.claimRepair?.();repairUsed=true;recoveryRoute=route;}
          }else{
            context.preserveOriginal?.(partial);
            if(route.provider==='openrouter'&&!context.manualContinuation||!this.allowLlmRepair||repairUsed)throw new Fault(context.validationFailure??'LLM_INVALID_HTML',502);
            if(this.repairs===0)partial=''; // An explicitly continued fresh generation, without draft repair.
            else{context.claimRepair?.();repairUsed=true;}
            recoveryRoute=route;
          }
        }
      }
      // A claimed repair survives even an incomplete last response. Such a draft
      // may be revalidated above, but Continue/restart cannot authorize a new POST.
      if(priorRepairUsed)throw new Fault(context?.validationFailure??'LLM_REPAIR_LIMIT',502);
      // Preserve a useful checkpoint, but discard known broken mechanics when
      // moving to the next route. Never traverse the provider list twice.
      const freshIssues=['BROWSER_INPUT_NO_EFFECT','BROWSER_START_CONTROL','BROWSER_MOBILE_LAYOUT','BROWSER_GAME_AREA','BROWSER_HORIZONTAL_OVERFLOW','BROWSER_INSTANT_END','BROWSER_AUTOSTART','BROWSER_DUPLICATE_START','BROWSER_EVENT_ORDER','LLM_INVALID_HTML','LLM_UNSAFE_ARTIFACT','LLM_INVALID_RESPONSE','LLM_OUTPUT_TRUNCATED'];
      for(const route of recoveryRoute?[recoveryRoute]:routes){
        const stored=context?.cooldowns?.[route.provider+'/'+route.model];if(stored&&stored.until>Date.now())this.cooldowns.set(route.provider+'/'+route.model,stored);
        const key=route.provider+'/'+route.model,cooldown=this.cooldowns.get(key);
        if(context?.blockedRoutes?.includes(key))continue;
        if(cooldown&&cooldown.until>Date.now()){lastCode=cooldown.code;if(Number.isFinite(cooldown.until))context?.retryAt?.(cooldown.until);continue;}
        const partialResumable=Boolean(partial)&&!freshIssues.includes(lastCode);
        const messages=generationMessages(spec,previous,this.promptStyle);context?.trace?.('provider.selected',{provider:route.provider,requestedModel:route.model});context?.trace?.('prompt.prepared',{inputBytes:Buffer.byteLength(JSON.stringify(messages)),next:'request'});
        if(partial&&partialResumable)messages.push({role:'assistant',content:partial},{role:'user',content:'Recover this draft using the original requirements. Return one complete concise HTML document, not a continuation fragment. Preserve working mechanics. Never concatenate unverified fragments. '+recoveryIssue});
        for(let repair=0;repair<=Math.min(1,this.repairs);repair++){
          if(context&&attempts.length>=(context.maxCalls??6))throw new GenerationFailure(attempts.at(-1)?.errorCode??'JOB_ATTEMPT_LIMIT',attempts,409);
          const begin=performance.now();let actual:string|null=null,code='',requestMs=0,validationMs=0;let tokens:TokenUsage={};
          const requestController=new AbortController(),requestTimer=setTimeout(()=>requestController.abort(),this.requestTimeout);
          const requestSignal=AbortSignal.any([controller.signal,requestController.signal]);
          try{
            context?.stage(repair||repairUsed?'repairing':'generating');if(!route.observesDispatch)context?.dispatch(route);
            const transportContext=context?{...context,partial:(value:string,model:string|null,usage?:TokenUsage)=>{if(value)partial=value;if(model)actual=model;if(usage)tokens={...tokens,...usage};context.partial(value,model,usage);}}:undefined;
            const response=await route.complete(messages,requestSignal,transportContext);clearTimeout(requestTimer);requestMs=Math.round(performance.now()-begin);actual=response.model;tokens={...(response.outputTokens===undefined?{}:{outputTokens:response.outputTokens}),...(response.reasoningTokens===undefined?{}:{reasoningTokens:response.reasoningTokens})};partial=response.code;context?.partial(partial,actual,tokens);
            const checkBegan=performance.now();let checked;try{checked=await checkDocument(response.code);}finally{validationMs=Math.round(performance.now()-checkBegan);}code=checked.code;const evidence=checked.evidence;if(repairUsed)context?.trace?.('repair.completed',{next:'save'});
            if(controller.signal.aborted)throw new Fault('REQUEST_CANCELLED',499);
            attempts.push({route:route.route,provider:route.provider,requestedModel:route.model,model:actual,outcome:'accepted',errorCode:null,elapsedMs:Math.round(performance.now()-begin),requestMs,validationMs,...tokens});context?.attempt(attempts.at(-1)!);
            return parseArtifact({html:code,method:'llm_code',provider:route.provider,model:actual,generationStatus:'succeeded',validationStatus:'passed',generation:{attempts,fallback:route!==routes[0],elapsedMs:Math.round(performance.now()-started),browser:evidence}});
          }catch(error){
            if(controller.signal.aborted){attempts.push({route:route.route,provider:route.provider,requestedModel:route.model,model:actual,outcome:'failed',errorCode:signal?.aborted?'REQUEST_CANCELLED':'LLM_TIMEOUT',elapsedMs:Math.round(performance.now()-begin),requestMs:requestMs||Math.round(performance.now()-begin),validationMs,...tokens});context?.attempt(attempts.at(-1)!);throw error;}
            if(error instanceof ProviderFailure){actual=error.actualModel;code=error.partial;tokens=error.usage;if(code)partial=code;context?.partial(code,actual,tokens);if(error.retryAt)context?.retryAt?.(error.retryAt);}
            // Extraction can throw before assigning code. Repair still needs the
            // confirmed raw response, including an incomplete HTML document.
            if(!code&&actual&&partial)code=partial;
            lastCode=requestController.signal.aborted?'LLM_TIMEOUT':error instanceof Fault?error.code:'LLM_NETWORK_OR_RESPONSE';
            attempts.push({route:route.route,provider:route.provider,requestedModel:route.model,model:actual,outcome:actual?'rejected':'failed',errorCode:lastCode,elapsedMs:Math.round(performance.now()-begin),requestMs:requestMs||Math.round(performance.now()-begin),validationMs,...tokens});context?.attempt(attempts.at(-1)!);
            if(['LLM_QUOTA','LLM_AUTH','LLM_MODEL_NOT_FOUND','FREE_MODEL_REQUIRED','LLM_CONTEXT_LIMIT','LLM_OUTPUT_BUDGET_TOO_SMALL'].includes(lastCode)){
              const until=Date.now()+900000;this.cooldowns.set(key,{until,code:lastCode});context?.cooldownRoute?.(route,until,lastCode);context?.blockRoute?.(route,lastCode);break;
            }
            if(lastCode==='LLM_RATE_LIMIT'){const until=error instanceof ProviderFailure&&error.retryAt?error.retryAt:Date.now()+60000;this.cooldowns.set(key,{until,code:lastCode});context?.cooldownRoute?.(route,until,lastCode);context?.retryAt?.(until);break;}
            if(context&&['RATE_LIMIT','JOB_ATTEMPT_LIMIT'].includes(lastCode))throw new GenerationFailure(lastCode,attempts,429);
            if(context&&['LLM_DNS','LLM_TCP_CONNECTION','LLM_PROXY_CONNECTION','LLM_NETWORK_UNAVAILABLE','LLM_RESPONSE_TIMEOUT','LLM_TIMEOUT','LLM_CONNECTION_INTERRUPTED','LLM_STREAM_ERROR'].includes(lastCode)){
              // Unknown remote billing must not cause unconditional duplicate
              // requests. A separate explicitly configured route can recover.
              if(!['openrouter','ollama','ollama.com'].includes(route.provider))context.blockRoute?.(route,lastCode);
              const until=Date.now()+5000;this.cooldowns.set(key,{until,code:lastCode});context.cooldownRoute?.(route,until,lastCode);context.retryAt?.(until);break;
            }
            if(['BROWSER_SANDBOX_UNAVAILABLE','BROWSER_SANDBOX_CONFIGURATION','BROWSER_INSTALL_REQUIRED','BROWSER_CHECKER_ERROR','BROWSER_STARTUP_FAILED'].includes(lastCode))throw new GenerationFailure(lastCode,attempts,503);
            const repairable=error instanceof BrowserFailure||/^(?:BROWSER_|JAVASCRIPT_EXCEPTION|LLM_INVALID_HTML|LLM_UNSAFE_ARTIFACT|LLM_OUTPUT_TRUNCATED)/.test(lastCode);
            if(!actual||!repairable)break;
            if(route.provider==='openrouter'||!this.allowLlmRepair||repairUsed||repair>=Math.min(1,this.repairs)||/BROWSER_TIMEOUT|INCONCLUSIVE/.test(lastCode))throw new GenerationFailure(lastCode,attempts);
            context?.preserveOriginal?.(partial);context?.trace?.('repair.started');context?.claimRepair?.();repairUsed=true;
            messages.push({role:'assistant',content:code||'No complete HTML was returned.'},{role:'user',content:'Browser/static verification rejected the result: '+lastCode+'. '+(error instanceof BrowserFailure?error.feedback:error instanceof CloudOutputFailure?'The output token budget was exhausted. Return complete HTML within the available token budget, without explanations; preserve all requested mechanics.':'')+' '+validateDocument(code).join(', ')+'. Fix this defect in the complete HTML, preserve the original request and all working mechanics. Do not start automatically, restart the state on resume, or duplicate lifecycle events. Original requirements: '+JSON.stringify(spec)});
          }finally{clearTimeout(requestTimer);}
        }
        if(repairUsed)throw new GenerationFailure(lastCode,attempts);
      }
      throw new GenerationFailure(lastCode,attempts);
    }catch(error){if(controller.signal.aborted)throw new GenerationFailure(signal?.aborted?'REQUEST_CANCELLED':'LLM_TIMEOUT',attempts,signal?.aborted?499:504);if(error instanceof GenerationFailure)throw error;throw new GenerationFailure(error instanceof Fault?error.code:'LLM_NETWORK_OR_RESPONSE',attempts);}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.abort();this.active=undefined;}
  }
}
export function configuredGenerator(env:NodeJS.ProcessEnv=process.env):GenerationEngine|undefined{
  const selection=env.LIVE_PROVIDER??'auto';if(selection==='none')return;
  // Old model/fallback values cannot dispatch arbitrary routes. Keys stay local;
  // the only production models and endpoints are fixed by MICRO-019.
  const selected=selection==='cloud'?'openrouter':selection==='ollama'?'auto':selection;
  if(!['auto','ollama-cloud','openrouter'].includes(selected))throw new Fault('INVALID_LIVE_PROVIDER');
  if(env.CLOUD_BASE_URL&&env.CLOUD_BASE_URL!=='https://openrouter.ai/api/v1')throw new Fault('FREE_MODEL_REQUIRED');
  const routes:CodeTransport[]=[];
  if(env.OLLAMA_CLOUD_API_KEY)routes.push(new CloudTransport({networkEnv:()=>env,base:'https://ollama.com/v1',key:env.OLLAMA_CLOUD_API_KEY,model:'gemma4:31b',maxTokens:Number(env.LLM_MAX_TOKENS??12000),temperature:env.LLM_TEMPERATURE?Number(env.LLM_TEMPERATURE):undefined,tokenField:(env.LLM_TOKEN_FIELD??'max_tokens') as 'max_tokens'|'max_completion_tokens'}));
  if(env.CLOUD_API_KEY)routes.push(new CloudTransport({networkEnv:()=>env,base:'https://openrouter.ai/api/v1',key:env.CLOUD_API_KEY,model:'openrouter/free',route:routes.length?'secondary':'primary',maxTokens:Number(env.LLM_MAX_TOKENS??12000),temperature:env.LLM_TEMPERATURE?Number(env.LLM_TEMPERATURE):undefined,tokenField:(env.LLM_TOKEN_FIELD??'max_tokens') as 'max_tokens'|'max_completion_tokens'}));
  if(!routes.length)return;
  return new GenerationEngine(routes,{allowLlmRepair:env.LLM_AUTO_REPAIR==='1',defaultMode:selected as ProviderMode,timeoutMs:Number(env.LLM_TIMEOUT_MS??180000),requestTimeoutMs:Number(env.LLM_REQUEST_TIMEOUT_MS??Math.min(Number(env.LLM_TIMEOUT_MS??180000),60000)),repairs:Number(env.LLM_REPAIRS??1),promptStyle:(env.LLM_PROMPT_STYLE??'direct') as 'spec'|'direct'});
}
