import type { TraceData } from './generation-trace.ts';
import { networkRequest, NetworkFailure } from './llm-network.ts';
import type { NetworkDiagnostic } from './llm-network.ts';
import { Fault } from './contracts.ts';
import type { Artifact, GameSpec, GameVersion } from './contracts.ts';
import type { GenerationAttempt } from './contracts.ts';
import type { ValidationDiagnostic, FormatRepair } from './validation.ts';
export type TokenUsage={outputTokens?:number;reasoningTokens?:number};
export type ProviderMode='auto'|'ollama-cloud'|'openrouter';
export function providerMode(value:unknown):ProviderMode {
  if(value===undefined)return 'auto';
  if(value!=='auto'&&value!=='ollama-cloud'&&value!=='openrouter')throw new Fault('INVALID_PROVIDER_MODE');
  return value;
}
export interface GenerationContext {
  trace?(event:string,data?:TraceData):void;
  providerMode?:ProviderMode;
  manualContinuation?:boolean;
  checkpoint?:string; maxCalls?:number;
  blockedRoutes?:string[];
  checkpointOrigin?:{provider:string;requestedModel:string;model:string};
  cooldowns?:Record<string,{until:number;code:string}>;
  cooldownRoute?(route:CodeTransport,until:number,code:string):void;
  blockRoute?(route:CodeTransport,code:string):void;
  stage(stage:'generating'|'validating'|'repairing'):void;
  dispatch(route:CodeTransport):void;
  partial(code:string,model:string|null,usage?:TokenUsage):void;
  attempt(attempt:GenerationAttempt):void;
  retryAt?(at:number):void;
  preserveOriginal?(html:string):void;
  validation?(diagnostic:ValidationDiagnostic,repair?:FormatRepair):void;
  repairUsed?:boolean;
  validationFailure?:string;
  claimRepair?():void;
}

export interface Generator {
  generate(spec: GameSpec, previous?: GameVersion, method?: 'llm_code', signal?: AbortSignal, context?:GenerationContext): Promise<Artifact>;
  close?(): void;
}
export function requiredMethod(value: unknown): 'llm_code' | undefined {
  if (value === undefined) return;
  if (value !== 'llm_code') throw new Fault('INVALID_REQUIRED_METHOD');
  return value;
}
export async function boundedText(response: Response, limit: number) {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Fault('BODY_TOO_LARGE', 413); }
  const reader = response.body?.getReader(); if (!reader) return '';
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > limit) throw new Fault('BODY_TOO_LARGE', 413); parts.push(part.value); }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export type Message = { role: 'system' | 'user' | 'assistant'; content: string };
export function boundedCode(code:string){return Buffer.from(code).subarray(0,200000).toString('utf8').replace(/\uFFFD$/,'');}
export class ProviderFailure extends Fault {
  diagnostic?:NetworkDiagnostic;wireBytes?:number;inputTokens?:number;finishReason?:string|null;
  readonly actualModel:string|null; readonly partial:string; readonly usage:TokenUsage;readonly retryAt:number|null;
  constructor(code:string,model:string|null=null,partial='',usage:TokenUsage={},retryAt:number|null=null,status=502){super(code,status);this.actualModel=model;this.partial=boundedCode(partial);this.usage=usage;this.retryAt=retryAt;}
}
export class CloudOutputFailure extends ProviderFailure {
  constructor(model:string,partial:string,usage:TokenUsage={}){super('LLM_OUTPUT_TRUNCATED',model,partial,usage);}
}
function providerError(status:number,detail=''){
  return status===401||status===403?'LLM_AUTH':status===429?(/quota.{0,50}(exhaust|exceed)|daily.{0,40}(limit|exhaust)|free-models-per-day|insufficient.{0,20}credit/i.test(detail)?'LLM_QUOTA':'LLM_RATE_LIMIT'):status===402?'LLM_QUOTA':status===413?'LLM_HTTP_BODY_TOO_LARGE':status===400&&/context|token.{0,20}(limit|maximum)|maximum.{0,20}context/i.test(detail)?'LLM_CONTEXT_LIMIT':status===404?'LLM_MODEL_NOT_FOUND':'LLM_HTTP';
}
export interface CodeTransport {
  route: 'primary' | 'secondary' | 'local'; provider: string; model: string;
  observesDispatch?:boolean;
  complete(messages: Message[], signal: AbortSignal, context?:GenerationContext): Promise<{ code: string; model: string }&TokenUsage>;
  readiness(signal: AbortSignal): Promise<string>;
}
function endpoint(base: string, local: boolean) {
  let url: URL;
  try { url = new URL(base); } catch { throw new Fault('INVALID_LLM_CONFIGURATION'); }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname)))) throw new Fault('INSECURE_LLM_URL');
  if (local && url.pathname !== '/') throw new Fault('INVALID_LLM_CONFIGURATION');
  return new URL(url.href.replace(/\/$/, '') + '/');
}
export class CloudTransport implements CodeTransport {
  readonly observesDispatch=true;
  readonly route: 'primary' | 'secondary'; readonly provider: string; readonly model: string;
  private networkEnv:()=>NodeJS.ProcessEnv;
  private base: URL; private key: string; private maxTokens: number; private temperature?: number; private tokenField: 'max_tokens' | 'max_completion_tokens';
  constructor(options: { networkEnv?:()=>NodeJS.ProcessEnv; base: string; key: string; model: string; route?: 'primary' | 'secondary'; maxTokens?: number; temperature?: number; tokenField?: 'max_tokens' | 'max_completion_tokens' }) {
    this.networkEnv=options.networkEnv??(()=>process.env);this.base = endpoint(options.base, false); this.key = options.key; this.model = options.model; this.route = options.route ?? 'primary';
    const hostname=this.base.hostname.replace(/\.+$/,'');
    this.provider = hostname === 'openrouter.ai' ? 'openrouter' : hostname;
    this.maxTokens = options.maxTokens ?? 12000; this.temperature = options.temperature; this.tokenField = options.tokenField ?? 'max_tokens';
    if (!this.key.trim() || /[\r\n]/.test(this.key) || this.key.length > 4096 || !this.model.trim() || this.model.length > 128 || this.provider.length > 128 || !Number.isSafeInteger(this.maxTokens) || this.maxTokens < 256 || this.maxTokens > 32000 || this.temperature !== undefined && (!Number.isFinite(this.temperature) || this.temperature < 0 || this.temperature > 2) || !['max_tokens','max_completion_tokens'].includes(this.tokenField)) throw new Fault('INVALID_LLM_CONFIGURATION');
    // This project's OpenRouter authorization is FREE ONLY, including secondary routes.
    if (this.provider === 'openrouter' && (this.base.href !== 'https://openrouter.ai/api/v1/' || this.model!=='openrouter/free')) throw new Fault('FREE_MODEL_REQUIRED');
    if (this.provider === 'ollama.com' && (this.base.href !== 'https://ollama.com/v1/' || this.model!=='gemma4:31b')) throw new Fault('FREE_MODEL_REQUIRED');
  }
  private async request(path: string, signal: AbortSignal, body?: object, observe?:(value:NetworkDiagnostic)=>void) {
    return this.response(path,signal,body,async response=>{
      let text:string;
      try { text=await boundedText(response,1_210_000); } catch(error) {
        if(error instanceof Fault&&error.code==='BODY_TOO_LARGE')throw new ProviderFailure('LLM_RESPONSE_BODY_TOO_LARGE');
        if(signal.aborted||error instanceof Fault)throw error;
        if(error instanceof TypeError&&(error as NodeJS.ErrnoException).code==='ERR_ENCODING_INVALID_ENCODED_DATA')throw new ProviderFailure('LLM_INVALID_RESPONSE');
        throw new ProviderFailure('LLM_CONNECTION_INTERRUPTED');
      }
      try { return JSON.parse(text); } catch { throw new ProviderFailure('LLM_INVALID_RESPONSE'); }
    },observe);
  }
  private async response<T>(path:string,signal:AbortSignal,body:object|undefined,consume:(response:Response)=>Promise<T>,observe?:(value:NetworkDiagnostic)=>void,context?:GenerationContext) {
    const began=performance.now();let snapshot:NetworkDiagnostic|undefined;
    try{return await networkRequest(new URL(path,this.base),{method:body?'POST':'GET',redirect:'error',signal,headers:{Authorization:'Bearer '+this.key,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})},this.provider,async(response,diagnostic)=>{
      snapshot=diagnostic;context?.trace?.('response.headers',{httpStatus:response.status,durationMs:Math.round(performance.now()-began)});try{
        if(!response.ok){
          let detail='';try{detail=await boundedText(response,16000);}catch{}
          const retry=response.headers.get('retry-after');const delay=retry&&/^\d+(\.\d+)?$/.test(retry)?Number(retry)*1000:retry?Date.parse(retry)-Date.now():0;
          const retryAt=Number.isFinite(delay)&&delay>0?Date.now()+Math.min(delay,86400000):null;
          throw new ProviderFailure(response.status===407?'LLM_PROXY_AUTH':providerError(response.status,detail),null,'',{},retryAt,response.status===429?429:502);
        }
        if(body)diagnostic.stage='stream';
        return await consume(response);
      }catch(error){if(error instanceof ProviderFailure){diagnostic.category=error.code;error.diagnostic={...diagnostic,durationMs:Math.round(performance.now()-began)};}throw error;}
    },this.networkEnv());}catch(error){
      if(error instanceof NetworkFailure){const failure=new ProviderFailure(error.code);failure.diagnostic=error.diagnostic;snapshot=error.diagnostic;throw failure;}
      if(error instanceof Fault){snapshot??={provider:this.provider,route:'configuration',stage:'configuration',durationMs:0,category:error.code};snapshot.category=error.code;}
      throw error;
    }finally{if(snapshot)observe?.({...snapshot,durationMs:Math.round(performance.now()-began)});}
  }
  async diagnose(signal:AbortSignal){
    const began=performance.now();let snapshot:NetworkDiagnostic|undefined;
    let state='unreachable',category='ok';
    try{const result=await this.request('models',signal,undefined,value=>snapshot=value);state=Array.isArray(result.data)&&result.data.some((m:{id?:string})=>m.id===this.model)?'ready':'model_missing';}
    catch(error){category=error instanceof Fault?error.code:'LLM_NETWORK_UNAVAILABLE';state=category==='LLM_AUTH'?'authentication_failed':'unreachable';}
    const network:NetworkDiagnostic={provider:this.provider,route:'configuration',stage:'configuration',...(snapshot as NetworkDiagnostic|undefined),durationMs:Math.round(performance.now()-began),category};
    return{state,network,inferenceVerified:false as const};
  }
  async complete(messages: Message[], signal: AbortSignal, context?:GenerationContext):Promise<{code:string;model:string}&TokenUsage> {
    let budget=this.maxTokens;
    // Bounded full source: never trim current HTML to make an edit fit.
    const inputBytes=Buffer.byteLength(JSON.stringify(messages));
    if(inputBytes>300000)throw new Fault('LLM_INPUT_TOO_LARGE',413);
    if(context){
      try{const catalog=await this.request('models',AbortSignal.any([signal,AbortSignal.timeout(3000)]),undefined,d=>context.trace?.('provider.catalog_completed',{httpStatus:d.httpStatus,durationMs:d.durationMs,networkRoute:d.route,networkStage:d.stage,errorCode:d.category==='ok'?null:d.category}));const selected=catalog.data?.find((m:{id:string})=>m.id===this.model);const limit=selected?.top_provider?.max_completion_tokens??selected?.max_completion_tokens;if(Number.isSafeInteger(limit)&&limit>0)budget=Math.min(budget,limit);const contextLength=selected?.context_length;if(Number.isSafeInteger(contextLength)&&contextLength>0&&inputBytes+budget>contextLength)throw new Fault('LLM_CONTEXT_LIMIT',413);if(this.provider==='ollama.com'&&!selected)throw new Fault('LLM_MODEL_NOT_FOUND',502);}
      catch(error){if(signal.aborted||error instanceof Fault&&['LLM_CONTEXT_LIMIT','LLM_AUTH','LLM_QUOTA','LLM_RATE_LIMIT','LLM_MODEL_NOT_FOUND','LLM_NETWORK_CONFIGURATION','LLM_PROXY_UNSUPPORTED','LLM_PROXY_AUTH','LLM_TLS','INSECURE_TLS_CONFIGURATION'].includes(error.code))throw error;}
      if(budget<2048)throw new Fault('LLM_OUTPUT_BUDGET_TOO_SMALL',502);
      // Conservative byte-based token allowance; no hidden source truncation.
      // Router catalogue limits do not guarantee the selected upstream's context.
      // Exact token counts depend on the provider tokenizer.

    }
    const body={model:this.model,messages,stream:Boolean(context),[this.tokenField]:budget,...(context?{stream_options:{include_usage:true}}:{}),...(this.provider==='openrouter'?{reasoning:{effort:'low',exclude:true},provider:{require_parameters:true}}:{}),...(this.temperature===undefined?{}:{temperature:this.temperature})};
    if(context){signal.throwIfAborted();context.dispatch(this);context.trace?.('request.started',{inputBytes:Buffer.byteLength(JSON.stringify(body)),maxOutputTokens:budget});const requestBegan=performance.now();try{return await this.response('chat/completions',signal,body,response=>this.stream(response,signal,context),undefined,context);}catch(error){context.trace?.('response.failed',{durationMs:Math.round(performance.now()-requestBegan),httpStatus:error instanceof ProviderFailure?error.diagnostic?.httpStatus:undefined,wireBytes:error instanceof ProviderFailure?error.wireBytes:undefined,outputBytes:error instanceof ProviderFailure&&error.wireBytes!==undefined?Buffer.byteLength(error.partial):undefined,inputTokens:error instanceof ProviderFailure?error.inputTokens:undefined,actualModel:error instanceof ProviderFailure?error.actualModel:undefined,finishReason:error instanceof ProviderFailure?error.finishReason:undefined,...(error instanceof ProviderFailure?error.usage:{}),networkRoute:error instanceof ProviderFailure?error.diagnostic?.route:undefined,networkStage:error instanceof ProviderFailure?error.diagnostic?.stage:undefined,errorCode:error instanceof Fault?error.code:signal.aborted?'LLM_TIMEOUT':'LLM_CONNECTION_INTERRUPTED'});throw error;}}
    const result = await this.request('chat/completions', signal, body);
    const choice = result.choices?.[0];
    if(!result.error&&choice?.finish_reason==='length'&&typeof result.model==='string'&&result.model.trim()&&result.model.length<=128)throw new CloudOutputFailure(result.model,typeof choice.message?.content==='string'?choice.message.content:'',usage(result.usage));
    if (result.error || choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string' || typeof result.model !== 'string' || !result.model.trim() || result.model.length > 128) throw new Fault('LLM_INVALID_RESPONSE', 502);
    if(this.provider==='ollama.com'&&result.model!==this.model)throw new Fault('LLM_INVALID_RESPONSE',502);
    // Free router intentionally reports the actual selected free model, not its router alias.
    return { code: choice.message.content, model: result.model,...usage(result.usage) };
  }
  private async stream(response:Response,signal:AbortSignal,context:GenerationContext){
    const reader=response.body?.getReader();if(!reader)throw new ProviderFailure('LLM_INVALID_RESPONSE');
    const decoder=new TextDecoder('utf8',{fatal:true});let buffer='',code='',model:string|null=null,finish:string|null=null,done=false,total=0,lastBytes=0,lastTime=Date.now(),tokens:TokenUsage={};const began=performance.now();let first=true,inputTokens:number|undefined;
    const checkpoint=(force=false)=>{if(force||Buffer.byteLength(code)-lastBytes>=4096||Date.now()-lastTime>=750){context.partial(code,model,tokens);lastBytes=Buffer.byteLength(code);lastTime=Date.now();}};
    const payload=(raw:string)=>{
      if(!raw)return;if(raw==='[DONE]'){done=true;return;}
      let data;try{data=JSON.parse(raw);}catch{throw new ProviderFailure('LLM_INVALID_RESPONSE',model,code,tokens);}
      if(typeof data.model==='string'&&data.model.trim()&&data.model.length<=128){if(this.provider==='ollama.com'&&data.model!==this.model)throw new ProviderFailure('LLM_INVALID_RESPONSE',null,code,tokens);model=data.model;}
      if(data.error){const failure=providerError(Number(data.error.code),typeof data.error.message==='string'?data.error.message.slice(0,16000):'');throw new ProviderFailure(failure==='LLM_HTTP'?'LLM_STREAM_ERROR':failure,model,code,tokens);}
      tokens={...tokens,...usage(data.usage)};if(Number.isSafeInteger(data.usage?.prompt_tokens)&&data.usage.prompt_tokens>=0&&data.usage.prompt_tokens<=1000000)inputTokens=data.usage.prompt_tokens;const choice=data.choices?.[0];if(choice?.finish_reason)finish=choice.finish_reason;
      const delta=choice?.delta?.content;if(typeof delta==='string'){code+=delta;if(Buffer.byteLength(code)>200000)throw new ProviderFailure('ARTIFACT_TOO_LARGE',model,code,tokens);checkpoint();}
    };
    let dataLines:string[]=[];const frame=(line:string)=>{if(line===''){if(dataLines.length)payload(dataLines.join('\n'));dataLines=[];}else if(line.startsWith('data:'))dataLines.push(line.slice(5).replace(/^ /,''));};
    try{
      // SSE's terminal marker ends the response even if a proxy keeps the body
      // open. Still require a valid model and stop reason before accepting code.
      for(;!done;){const part=await reader.read();if(part.done)break;if(first){first=false;context.trace?.('response.first_byte',{durationMs:Math.round(performance.now()-began)});}total+=part.value.length;if(total>1210000)throw new ProviderFailure('LLM_RESPONSE_BODY_TOO_LARGE',model,code,tokens);buffer+=decoder.decode(part.value,{stream:true});let end;while(!done&&(end=buffer.indexOf('\n'))>=0){frame(buffer.slice(0,end).replace(/\r$/,''));buffer=buffer.slice(end+1);}if(Buffer.byteLength(buffer)>1210000)throw new ProviderFailure('LLM_RESPONSE_BODY_TOO_LARGE',model,code,tokens);}
      if(!done){buffer+=decoder.decode();if(buffer.trim())frame(buffer.replace(/\r$/,''));if(dataLines.length)payload(dataLines.join('\n'));}checkpoint(true);
      context.trace?.('response.stream_completed',{wireBytes:total,inputTokens,actualModel:model,finishReason:finish,outputBytes:Buffer.byteLength(code),durationMs:Math.round(performance.now()-began),...tokens});
      if(finish==='length'&&model)throw new CloudOutputFailure(model,code,tokens);
      if(!done||finish!=='stop'||!model)throw new ProviderFailure('LLM_CONNECTION_INTERRUPTED',model,code,tokens);
      return{code,model,...tokens};
    }catch(error){checkpoint(true);if(error instanceof ProviderFailure){error.wireBytes=total;error.inputTokens=inputTokens;error.finishReason=finish;throw error;}if(signal.aborted)throw error;const failure=new ProviderFailure('LLM_CONNECTION_INTERRUPTED',model,code,tokens);failure.wireBytes=total;failure.inputTokens=inputTokens;failure.finishReason=finish;throw failure;}
    finally{await reader.cancel().catch(()=>{});}
  }
  async readiness(signal: AbortSignal) { return (await this.diagnose(signal)).state; }
}
function usage(value:unknown):TokenUsage{
  const data=value as {completion_tokens?:unknown;completion_tokens_details?:{reasoning_tokens?:unknown}}|undefined;
  const valid=(n:unknown)=>Number.isSafeInteger(n)&&(n as number)>=0&&(n as number)<=1000000;
  return{...(valid(data?.completion_tokens)?{outputTokens:data!.completion_tokens as number}:{}),...(valid(data?.completion_tokens_details?.reasoning_tokens)?{reasoningTokens:data!.completion_tokens_details!.reasoning_tokens as number}:{})};
}
export class OllamaTransport implements CodeTransport {
  readonly observesDispatch=true;
  readonly route = 'local'; readonly provider = 'ollama'; readonly model: string; private base: URL;
  constructor(options: { base?: string; model?: string } = {}) { this.base = endpoint(options.base ?? 'http://127.0.0.1:11434', true); this.model = options.model ?? 'qwen2.5-coder:14b'; if (!this.model.trim() || this.model.length > 128) throw new Fault('INVALID_LLM_CONFIGURATION'); }
  async complete(messages: Message[], signal: AbortSignal,context?:GenerationContext) {
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Fault('INSECURE_TLS_CONFIGURATION', 503);
    signal.throwIfAborted();context?.dispatch(this);
    let response:Response;try{response = await fetch(new URL('api/chat', this.base), { method:'POST',redirect:'error',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({model:this.model,messages,stream:Boolean(context),think:false,options:{temperature:0.2,num_predict:12000,num_ctx:16384}}) });}catch(error){if(signal.aborted)throw error;throw new ProviderFailure('LLM_CONNECTION_INTERRUPTED');}
    if (!response.ok) { await response.body?.cancel(); throw new Fault(response.status === 404 ? 'LLM_MODEL_NOT_FOUND' : 'LLM_HTTP',502); }
    if(context)return this.stream(response,signal,context);
    let result; try { result = JSON.parse(await boundedText(response,1_210_000)); } catch(error) { if(signal.aborted || error instanceof Fault)throw error;throw new Fault('LLM_INVALID_RESPONSE',502); }
    if (result.done !== true || result.done_reason && result.done_reason !== 'stop' || result.model !== this.model || typeof result.message?.content !== 'string') throw new Fault('LLM_INVALID_RESPONSE',502);
    return {code:result.message.content,model:result.model};
  }
  private async stream(response:Response,signal:AbortSignal,context:GenerationContext){
    const reader=response.body?.getReader();if(!reader)throw new ProviderFailure('LLM_INVALID_RESPONSE');
    const decoder=new TextDecoder('utf8',{fatal:true});let buffer='',code='',total=0,lastBytes=0,lastTime=Date.now(),done=false,finish='';let outputTokens:number|undefined;
    const checkpoint=(force=false)=>{if(force||Buffer.byteLength(code)-lastBytes>=4096||Date.now()-lastTime>=750){context.partial(code,this.model,{...(outputTokens===undefined?{}:{outputTokens})});lastBytes=Buffer.byteLength(code);lastTime=Date.now();}};
    const frame=(raw:string)=>{if(!raw.trim())return;const data=JSON.parse(raw);if(data.model&&data.model!==this.model)throw new ProviderFailure('LLM_INVALID_RESPONSE',this.model,code);if(data.error)throw new ProviderFailure('LLM_STREAM_ERROR',this.model,code);if(typeof data.message?.content==='string'){code+=data.message.content;if(Buffer.byteLength(code)>200000)throw new ProviderFailure('ARTIFACT_TOO_LARGE',this.model,code);checkpoint();}if(data.done===true){done=true;finish=data.done_reason??'stop';if(Number.isSafeInteger(data.eval_count)&&data.eval_count>=0&&data.eval_count<=1000000)outputTokens=data.eval_count;}};
    try{for(;;){const part=await reader.read();if(part.done)break;total+=part.value.length;if(total>1210000)throw new ProviderFailure('BODY_TOO_LARGE',this.model,code);buffer+=decoder.decode(part.value,{stream:true});let end;while((end=buffer.indexOf('\n'))>=0){frame(buffer.slice(0,end));buffer=buffer.slice(end+1);}if(buffer.length>250000)throw new ProviderFailure('BODY_TOO_LARGE',this.model,code);}buffer+=decoder.decode();frame(buffer);checkpoint(true);if(finish==='length')throw new CloudOutputFailure(this.model,code,{...(outputTokens===undefined?{}:{outputTokens})});if(!done||finish!=='stop')throw new ProviderFailure('LLM_CONNECTION_INTERRUPTED',this.model,code);return{code,model:this.model,...(outputTokens===undefined?{}:{outputTokens})};}catch(error){checkpoint(true);if(error instanceof ProviderFailure||signal.aborted)throw error;throw new ProviderFailure('LLM_CONNECTION_INTERRUPTED',this.model,code);}finally{await reader.cancel().catch(()=>{});}
  }
  async readiness(signal: AbortSignal) {
    try { const response=await fetch(new URL('api/tags',this.base),{signal,redirect:'error'});const result=JSON.parse(await boundedText(response,100000));return response.ok && Array.isArray(result.models) ? result.models.some((m:{name?:string})=>m.name===this.model)?'ready':'model_missing':'unreachable'; } catch {return 'unreachable';}
  }
}
