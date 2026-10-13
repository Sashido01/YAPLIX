import { Fault, parseArtifact, parseSpec } from './contracts.ts';
import type { Artifact, GenerationAttempt, GameSpec, GameVersion } from './contracts.ts';
import { CloudTransport, OllamaTransport } from './transport.ts';
import type { CodeTransport, Generator } from './transport.ts';
import { browserCheck, checkerReady, BrowserFailure } from './browser-check.ts';
import { generationMessages, extractDocument, validateDocument } from './generation.ts';

export class GenerationFailure extends Fault {
  readonly attempts: GenerationAttempt[];
  constructor(code: string, attempts: GenerationAttempt[], status=502){super(code,status);this.attempts=attempts;}
}
export class GenerationEngine implements Generator {
  readonly routes: CodeTransport[]; private timeout: number; private repairs: number; private active?: AbortController;
  private check: typeof browserCheck;
  constructor(routes: CodeTransport[],options:{timeoutMs?:number;repairs?:number;check?:typeof browserCheck}={}){
    this.routes=routes;this.timeout=options.timeoutMs??180000;this.repairs=options.repairs??1;this.check=options.check??browserCheck;
    if(!routes.length||routes.length>3||!Number.isSafeInteger(this.timeout)||this.timeout<1000||this.timeout>300000||!Number.isSafeInteger(this.repairs)||this.repairs<0||this.repairs>2)throw new Fault('INVALID_LLM_CONFIGURATION');
  }
  close(){this.active?.abort();}
  async readiness(){const state=await this.routes[0].readiness(AbortSignal.timeout(3000));return{liveConfigured:true,liveReady:state==='ready'&&checkerReady(),llmState:state==='ready'&&!checkerReady()?'browser_missing':state,provider:this.routes[0].provider,model:this.routes[0].model,browserReady:checkerReady(),fallbackConfigured:this.routes.length>1};}
  async generate(spec:GameSpec,previous?:GameVersion,method?:'llm_code',signal?:AbortSignal):Promise<Artifact>{
    parseSpec(spec);if(method!==undefined&&method!=='llm_code')throw new Fault('INVALID_REQUIRED_METHOD');
    if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw new Fault('INSECURE_TLS_CONFIGURATION',503);
    if(this.check===browserCheck&&!checkerReady())throw new Fault('BROWSER_INSTALL_REQUIRED',503);
    if(this.active)throw new Fault('LLM_BUSY',409);
    const controller=new AbortController();this.active=controller;const timer=setTimeout(()=>controller.abort(),this.timeout),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    const attempts:GenerationAttempt[]=[];const started=performance.now();
    try{
      let lastCode='LLM_GENERATION_FAILED';
      for(const route of this.routes){
        const messages=generationMessages(spec,previous);
        for(let repair=0;repair<=this.repairs;repair++){
          const begin=performance.now();let actual:string|null=null,code='';
          try{
            const response=await route.complete(messages,controller.signal);actual=response.model;code=extractDocument(response.code);
            const issues=validateDocument(code);if(issues.length)throw new Fault('LLM_UNSAFE_ARTIFACT',502);
            const evidence=await this.check(code,controller.signal);
            if(controller.signal.aborted)throw new Fault('REQUEST_CANCELLED',499);
            attempts.push({route:route.route,provider:route.provider,requestedModel:route.model,model:actual,outcome:'accepted',errorCode:null,elapsedMs:Math.round(performance.now()-begin)});
            return parseArtifact({html:code,method:'llm_code',provider:route.provider,model:actual,generationStatus:'succeeded',validationStatus:'passed',generation:{attempts,fallback:route!==this.routes[0],elapsedMs:Math.round(performance.now()-started),browser:evidence}});
          }catch(error){
            if(controller.signal.aborted)throw error;
            lastCode=error instanceof Fault?error.code:'LLM_NETWORK_OR_RESPONSE';
            attempts.push({route:route.route,provider:route.provider,requestedModel:route.model,model:actual,outcome:actual?'rejected':'failed',errorCode:lastCode,elapsedMs:Math.round(performance.now()-begin)});
            if(!actual||repair===this.repairs||lastCode==='BROWSER_INSTALL_REQUIRED')break;
            messages.push({role:'assistant',content:code||'No complete HTML was returned.'},{role:'user',content:'Browser/static verification rejected the result: '+lastCode+'. '+(error instanceof BrowserFailure?error.feedback:'')+' '+validateDocument(code).join(', ')+'. Fix this defect in the complete HTML, preserve the original request and all working mechanics. Do not start automatically, restart the state on resume, or duplicate lifecycle events. Original requirements: '+JSON.stringify(spec)});
          }
        }
      }
      throw new GenerationFailure(lastCode,attempts);
    }catch(error){if(controller.signal.aborted)throw new GenerationFailure(signal?.aborted?'REQUEST_CANCELLED':'LLM_TIMEOUT',attempts,signal?.aborted?499:504);if(error instanceof GenerationFailure)throw error;throw new GenerationFailure(error instanceof Fault?error.code:'LLM_NETWORK_OR_RESPONSE',attempts);}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.abort();this.active=undefined;}
  }
}
export function configuredGenerator(env:NodeJS.ProcessEnv=process.env):GenerationEngine|undefined{
  const selection=env.LIVE_PROVIDER??'cloud';if(selection==='none')return;
  const cloud=(secondary=false)=>{const prefix=secondary?'SECONDARY_':'CLOUD_';return new CloudTransport({base:env[prefix+'BASE_URL']??(secondary?'':'https://openrouter.ai/api/v1'),key:env[prefix+'API_KEY']??'',model:env[prefix+'MODEL']??(secondary?'':'openrouter/free'),route:secondary?'secondary':'primary',maxTokens:Number(env.LLM_MAX_TOKENS??12000),temperature:env.LLM_TEMPERATURE?Number(env.LLM_TEMPERATURE):undefined,tokenField:(env.LLM_TOKEN_FIELD??'max_tokens') as 'max_tokens'|'max_completion_tokens'});};
  let routes:CodeTransport[];
  if(selection==='cloud'){if(!env.CLOUD_API_KEY)return;routes=[cloud()];}
  else if(selection==='ollama')routes=[new OllamaTransport({base:env.OLLAMA_BASE_URL,model:env.OLLAMA_MODEL})];
  else throw new Fault('INVALID_LIVE_PROVIDER');
  if(env.LLM_FALLBACK==='secondary'){if(!env.SECONDARY_API_KEY||!env.SECONDARY_BASE_URL||!env.SECONDARY_MODEL)throw new Fault('FALLBACK_NOT_CONFIGURED');routes.push(cloud(true));}
  else if(env.LLM_FALLBACK==='ollama')routes.push(new OllamaTransport({base:env.OLLAMA_BASE_URL,model:env.OLLAMA_MODEL}));
  else if(env.LLM_FALLBACK&&env.LLM_FALLBACK!=='none')throw new Fault('INVALID_FALLBACK');
  if(routes[0].provider==='openrouter'&&routes.some(r=>r.route==='secondary'&&r.provider!=='openrouter'))throw new Fault('FREE_MODEL_REQUIRED');
  return new GenerationEngine(routes,{timeoutMs:Number(env.LLM_TIMEOUT_MS??180000),repairs:Number(env.LLM_REPAIRS??1)});
}
