// Independent implementation of the documented SIWC public-client protocol.
// Standalone owner-operated feasibility only: no generator, API route or token files.
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:http';
import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {dirname,isAbsolute,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalJWKSet,jwtVerify} from 'jose';
import {Fault} from '../contracts.ts';
import {chatGptRequest} from '../chatgpt-http.ts';
import {networkRequest} from '../llm-network.ts';

export const SIWC=Object.freeze({issuer:'https://auth.openai.com',discovery:'https://auth.openai.com/.well-known/openid-configuration',authorize:'https://auth.openai.com/api/accounts/authorize',token:'https://auth.openai.com/api/accounts/oauth/token',jwks:'https://auth.openai.com/.well-known/jwks.json'});
const SCOPE='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const PROBE_MODEL='gpt-6.1-sol';
const STREAM_EVENTS=[
 'response.created','response.queued','response.in_progress','response.output_item.added','response.output_item.done',
 'response.content_part.added','response.content_part.done','response.output_text.delta','response.output_text.done',
 'response.completed','response.failed','response.incomplete','error',
 'response.reasoning_summary_part.added','response.reasoning_summary_part.done',
 'response.reasoning_summary_text.delta','response.reasoning_summary_text.done',
 'response.reasoning_text.delta','response.reasoning_text.done','response.refusal.delta','response.refusal.done',
] as const;
type StreamEvent=typeof STREAM_EVENTS[number];
type StreamDiagnostics={eventCounts:Partial<Record<StreamEvent|'unknown',number>>;lastEventType:StreamEvent|'unknown'|null;
 responseStatus:string|null;apiErrorCode:string|null;incompleteReason:string|null;textPresent:boolean;textLength:number;receivedBytes:number};
// Provider-controlled metadata is not trusted log text. Unknown values are
// represented by a fixed marker, never copied into reports.
const API_CODES=['subscription_sharing_usage_limit_exceeded','subscription_sharing_usage_unavailable','rate_limit_exceeded','insufficient_quota','server_error','invalid_request_error','model_not_found','unsupported_parameter','invalid_value','context_length_exceeded','content_policy_violation'];
const safeCode=(value:unknown,allowed:readonly string[])=>typeof value==='string'&&value?allowed.includes(value)?value:'OTHER':null;
const moduleRoot=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const root=existsSync(resolve(moduleRoot,'package.json'))?moduleRoot:resolve(moduleRoot,'..');
type Registration={clientId:string;subject:string|null;issuer:typeof SIWC.issuer};
type Status={connected:boolean;planPermissionGranted:boolean;registered:boolean};
type ProbeModel={slug:string;display_name:string;visibility:'list'};
export type SiwcProbeReport={
 result:'PASS'|'PARTIAL';authorization:'VERIFIED';planPermissionGranted:true;
 models:ProbeModel[];selectedModel:ProbeModel|null;inference:'NOT_RUN'|'ATTEMPTED'|'COMPLETED'|'COMPLETED_EMPTY'|'FAILED'|'INCOMPLETE'|'ERROR'|'INTERRUPTED'|'INVALID_SSE';
 textReceived:boolean;exactMatch:boolean;usage:Record<string,number>|null;diagnostics:StreamDiagnostics;
 providerCalls:{modelsGet:number;inferencePost:number};tokensPersisted:false;
 error:string|null;httpStatus:number|null;
 responseMediaType:'event-stream'|'json'|'other'|'missing'|null;sseObserved:boolean;
 requestedReasoningEffort:'medium';
 requestedModel:typeof PROBE_MODEL;actualModel:string|null;
};
export class SiwcError extends Error {constructor(code:string){super(code);this.name='SiwcError';}}
function fail(code:string):never{throw new SiwcError(code);}
const same=(a:string,b:string)=>{const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);};
function safeDirectory(value:string){
 const base=resolve(root,'.local'),directory=resolve(value),rel=relative(base,directory);
 if(!rel||isAbsolute(rel)||rel.startsWith('..'))fail('SIWC_STORAGE_PATH');
 for(let path=directory;path!==root;path=dirname(path))if(existsSync(path)&&lstatSync(path).isSymbolicLink())fail('SIWC_STORAGE_LINK');
 mkdirSync(directory,{recursive:true,mode:0o700});return directory;
}
function readRecord(path:string){
 if(!existsSync(path))return null;
 if(lstatSync(path).isSymbolicLink()||!lstatSync(path).isFile()||lstatSync(path).size>8192)fail('SIWC_STORAGE_INVALID');
 try{return JSON.parse(readFileSync(path,'utf8'));}catch{fail('SIWC_STORAGE_INVALID');}
}

export class LocalSiwc {
 #directory:string;#request:typeof fetch;#open:(url:string)=>Promise<void>;#timeout:number;#networkEnv:NodeJS.ProcessEnv;
 #host:string|null=null;#registration:Registration|null=null;#tokens:{access:string;refresh:string;id:string;expiresAt:number}|null=null;
 #active:AbortController|null=null;
 #authorizationLock:'disk'|'process';
 #probeUsed=false;#requests=new Set<AbortController>();
 constructor(options:{directory?:string;request?:typeof fetch;openBrowser:(url:string)=>Promise<void>;timeoutMs?:number;authorizationLock?:'disk'|'process';networkEnv?:NodeJS.ProcessEnv}){
  this.#authorizationLock=options.authorizationLock??'disk';
  this.#directory=resolve(options.directory??resolve(root,'.local/siwc-feasibility'));
  this.#request=options.request??fetch;this.#open=options.openBrowser;this.#timeout=options.timeoutMs??180000;this.#networkEnv=options.networkEnv??process.env;
  if(!Number.isSafeInteger(this.#timeout)||this.#timeout<50||this.#timeout>300000)fail('SIWC_TIMEOUT_INVALID');
 }
 prepare(){
  safeDirectory(this.#directory);const path=resolve(this.#directory,'host.json');
  if(!existsSync(path)){try{writeFileSync(path,JSON.stringify({hostId:'urn:uuid:'+randomUUID()})+'\n',{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')fail('SIWC_STORAGE_UNAVAILABLE');}}
  const host=readRecord(path);if(!/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(host?.hostId??''))fail('SIWC_HOST_INVALID');
  this.#host=host.hostId;
  const registration=readRecord(resolve(this.#directory,'registration.json'));
  if(registration&&(!/^oaiapp_[A-Za-z0-9_-]{1,200}$/.test(registration.clientId??'')||registration.issuer!==SIWC.issuer||(registration.subject!==null&&(typeof registration.subject!=='string'||!registration.subject))))fail('SIWC_REGISTRATION_INVALID');
  this.#registration=registration;return{hostId:this.#host!,registered:Boolean(registration)};
 }
 status():Status{const connected=Boolean(this.#tokens&&this.#tokens.expiresAt>Date.now());return{connected,planPermissionGranted:connected,registered:Boolean(this.#registration)};}
 dispose(){this.#active?.abort();for(const request of this.#requests)request.abort();this.#tokens=null;}
 async respond(messages:{role:'system'|'user'|'assistant';content:string}[],signal:AbortSignal,beforePost:()=>void,maxTextBytes:number,longWait=false,onResponse?:(status:number)=>void,onStreamComplete?:(details:{wireBytes:number;outputBytes:number;model:string})=>void){
  if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')fail('SIWC_INSECURE_TLS');
  if(!this.status().connected)fail('SIWC_PLAN_PERMISSION_REQUIRED');
  const tokens=this.#tokens!,controller=new AbortController();this.#requests.add(controller);
  const combined=AbortSignal.any([signal,controller.signal]);
  try{
   if(combined.aborted)fail('SIWC_REQUEST_CANCELLED');
   const body=JSON.stringify({model:PROBE_MODEL,input:messages,reasoning:{effort:'medium'},store:false,stream:true});
   // The worker must durably claim its one POST immediately before this boundary.
   try{beforePost();}
   catch(error){if(error instanceof Fault)throw new Fault(error.code,error.status);if(error instanceof SiwcError)throw error;fail('SIWC_DISPATCH_FAILED');}
   try{
   const consume=async(response:Response,readSignal:AbortSignal)=>{
    onResponse?.(response.status);
    if(!response.ok){await response.body?.cancel();if(response.status===401||response.status===403)this.dispose();fail(response.status===401||response.status===403?'SIWC_AUTH_REQUIRED':response.status===429?'SIWC_RATE_LIMIT':'SIWC_INFERENCE_HTTP');}
    const report=newStreamReport(),code=await readSiwcStream(response,readSignal,report,maxTextBytes);
    if([tokens.access,tokens.refresh,tokens.id].some(secret=>code.includes(secret)))fail('SIWC_OUTPUT_REJECTED');
    onStreamComplete?.({wireBytes:report.diagnostics.receivedBytes??0,outputBytes:Buffer.byteLength(code),model:PROBE_MODEL});
    return{code,model:PROBE_MODEL,...(report.usage?.output_tokens===undefined?{}:{outputTokens:report.usage.output_tokens})};
   };
   const url='https://api.openai.com/v1/responses',init:RequestInit={method:'POST',redirect:'error',signal:combined,headers:{Authorization:'Bearer '+tokens.access,Accept:'text/event-stream','Content-Type':'application/json'},body};
   return longWait?await chatGptRequest(this.#request,url,init,consume):await consume(await this.#request(url,init),combined);
   }catch(error){if(error instanceof SiwcError)throw error;if(combined.aborted)fail('SIWC_REQUEST_CANCELLED');fail('SIWC_NETWORK');}
  }finally{this.#requests.delete(controller);controller.abort();}
 }
 async probe(options:{signal?:AbortSignal;timeoutMs?:number}={}):Promise<SiwcProbeReport>{
  if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')fail('SIWC_INSECURE_TLS');
  if(this.#active)fail('SIWC_BUSY');
  if(this.#probeUsed)fail('SIWC_PROBE_ALREADY_USED');
  if(!this.status().planPermissionGranted)fail('SIWC_PLAN_PERMISSION_REQUIRED');
  const timeout=options.timeoutMs??60000;
  if(!Number.isSafeInteger(timeout)||timeout<50||timeout>120000)fail('SIWC_TIMEOUT_INVALID');
  this.#probeUsed=true;
  const controller=new AbortController();this.#active=controller;
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(timeout),...(options.signal?[options.signal]:[])]);
  const tokens=this.#tokens!;
  // Do not expose provider text or metadata that might echo a credential.
  const safe=(value:string)=>[tokens.access,tokens.refresh,tokens.id].reduce((text,secret)=>text.split(secret).join('[REDACTED]'),value).replace(/[\u0000-\u001f\u007f]/g,'');
  const report=newStreamReport();
  const request=async(url:string,body?:object)=>{
   signal.throwIfAborted();
   if(!this.status().planPermissionGranted)fail('SIWC_PLAN_PERMISSION_REQUIRED');
   report.httpStatus=null;
   if(body){report.providerCalls.inferencePost++;report.inference='ATTEMPTED';}else report.providerCalls.modelsGet++;
   const response=await this.#request(url,{method:body?'POST':'GET',redirect:'error',signal,headers:{Authorization:'Bearer '+tokens.access,Accept:body?'text/event-stream':'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
   report.httpStatus=response.status;
   if(!response.ok){await response.body?.cancel();fail(body?'SIWC_INFERENCE_HTTP':'SIWC_MODELS_HTTP');}
   return response;
  };
  // Same bounded reader for catalog and SSE; cancellation also covers a stalled body.
  const read=async(response:Response,consume:(text:string,done:boolean)=>boolean,inference=false)=>{
   const reader=response.body?.getReader();if(!reader)fail('SIWC_RESPONSE_INVALID');
   const decoder=new TextDecoder('utf-8',{fatal:true});let size=0;
   const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
   try{
    for(;;){signal.throwIfAborted();const next=await reader.read();signal.throwIfAborted();
     if(next.done){let tail:string;try{tail=decoder.decode();}catch{fail(inference?'SIWC_SSE_INVALID':'SIWC_MODELS_INVALID');}consume(tail,true);break;}
     size+=next.value.byteLength;if(inference)report.diagnostics.receivedBytes=size;
     if(size>1000000)fail('SIWC_RESPONSE_TOO_LARGE');
     let decoded:string;try{decoded=decoder.decode(next.value,{stream:true});}catch{fail(inference?'SIWC_SSE_INVALID':'SIWC_MODELS_INVALID');}
     if(consume(decoded,false))break;
    }
   }catch(error){if(inference&&!(error instanceof SiwcError)&&!signal.aborted)fail('SIWC_STREAM_INTERRUPTED');throw error;}
   finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});}
  };
  try{
   const catalogResponse=await request('https://api.openai.com/v1/models');let catalogText='';
   await read(catalogResponse,text=>{catalogText+=text;return false;});
   const catalog=JSON.parse(catalogText);
   if(!Array.isArray(catalog?.models)||catalog.models.length>1000)fail('SIWC_MODELS_INVALID');
   const models:ProbeModel[]=catalog.models.filter((m:any)=>m?.visibility==='list'&&typeof m.slug==='string'&&/^[a-zA-Z0-9._-]{1,160}$/.test(m.slug)&&typeof m.display_name==='string'&&m.display_name.length>0&&m.display_name.length<=200).map((m:any)=>({slug:m.slug,display_name:m.display_name,visibility:'list'}));
   report.models=models.map(m=>({...m,slug:safe(m.slug),display_name:safe(m.display_name)}));
   // Owner-pinned model: check this account's fresh catalog on every attempt.
   // No aliases, Pro, automatic replacement or cached catalog fallback.
   const selected=models.find(m=>m.slug===PROBE_MODEL);
   if(!selected)fail('SIWC_PROBE_MODEL_UNAVAILABLE');
   report.selectedModel={...selected,slug:safe(selected.slug),display_name:safe(selected.display_name)};
   const response=await request('https://api.openai.com/v1/responses',{model:selected.slug,input:[{role:'user',content:'Ответь точно: YAPLIX READY'}],store:false,stream:true,reasoning:{effort:'medium'}});
   await readSiwcStream(response,signal,report);
   if(report.exactMatch)report.result='PASS';else report.error='SIWC_OUTPUT_UNEXPECTED';
  }catch(error){
   report.error=signal.aborted?'SIWC_PROBE_CANCELLED':error instanceof SiwcError?error.message:'SIWC_PROBE_INVALID_OR_NETWORK';
   if(report.error==='SIWC_SSE_INVALID')report.inference='INVALID_SSE';
   if(report.error==='SIWC_STREAM_INTERRUPTED')report.inference='INTERRUPTED';
  }finally{controller.abort();this.#active=null;}
  return report;
 }
 #saveRegistration(value:Registration){
  const path=resolve(this.#directory,'registration.json'),temporary=path+'.'+randomUUID()+'.tmp';
  try{writeFileSync(temporary,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});renameSync(temporary,path);this.#registration=value;}
  catch{fail('SIWC_STORAGE_UNAVAILABLE');}finally{if(existsSync(temporary))unlinkSync(temporary);}
 }
 async #json(url:string,signal:AbortSignal,body?:URLSearchParams):Promise<any>{
  if(url!==SIWC.discovery&&url!==SIWC.jwks&&url!==SIWC.token)fail('SIWC_ENDPOINT_REJECTED');
  try{
   return await networkRequest(new URL(url),{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),headers:{Accept:'application/json',...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(body?{body:body.toString()}:{})},'chatgpt-auth',async response=>{
    if(!response.ok){await response.body?.cancel();const endpoint=body?'TOKEN':url===SIWC.discovery?'DISCOVERY':'JWKS';throw new Fault(`SIWC_${endpoint}_HTTP_${response.status}`, 502);}
    const reader=response.body?.getReader();if(!reader)fail('SIWC_RESPONSE_INVALID');let size=0;const chunks:Uint8Array[]=[];
    try{for(;;){const next=await reader!.read();if(next.done)break;size+=next.value.byteLength;if(size>100000)fail('SIWC_RESPONSE_TOO_LARGE');chunks.push(next.value);}}finally{await reader!.cancel().catch(()=>{});}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('SIWC_RESPONSE_INVALID');}
   },this.#networkEnv,this.#request);
  }catch(error){
   if(error instanceof SiwcError)throw error;
   if(error instanceof Fault && /^SIWC_(?:DISCOVERY|TOKEN|JWKS)_HTTP_[1-5][0-9]{2}$/.test(error.code)) fail(error.code);
   if(signal.aborted)fail('SIWC_CANCELLED');
   if(error instanceof Fault){const mapped:Record<string,string>={LLM_NETWORK_CONFIGURATION:'SIWC_NETWORK_CONFIGURATION',LLM_PROXY_UNSUPPORTED:'SIWC_PROXY_UNSUPPORTED',LLM_PROXY_AUTH:'SIWC_PROXY_AUTH',LLM_PROXY_CONNECTION:'SIWC_PROXY_CONNECTION',LLM_TLS:'SIWC_TLS',LLM_DNS:'SIWC_DNS',LLM_TCP_CONNECTION:'SIWC_TCP_CONNECTION',LLM_RESPONSE_TIMEOUT:'SIWC_NETWORK_TIMEOUT',LLM_NETWORK_UNAVAILABLE:'SIWC_NETWORK_UNAVAILABLE',INSECURE_TLS_CONFIGURATION:'SIWC_INSECURE_TLS',REQUEST_CANCELLED:'SIWC_CANCELLED'};if(mapped[error.code])fail(mapped[error.code]);}
   fail('SIWC_NETWORK');
  }
 }
 async signIn(signal?:AbortSignal):Promise<Status>{
  if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')fail('SIWC_INSECURE_TLS');
  if(this.#active)fail('SIWC_BUSY');this.prepare();
  const lock=this.#authorizationLock==='disk'?resolve(this.#directory,'authorization.lock'):null;
  try{if(lock)writeFileSync(lock,'pending\n',{flag:'wx',mode:0o600});}catch{fail('SIWC_BUSY');}
  const controller=new AbortController();this.#active=controller;
  const combined=AbortSignal.any([controller.signal,AbortSignal.timeout(this.#timeout),...(signal?[signal]:[])]);
  let state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
  let claimed=false,redirectUri='';
  let resolveResult!:(value:Status)=>void,rejectResult!:(error:unknown)=>void;
  const result=new Promise<Status>((yes,no)=>{resolveResult=yes;rejectResult=no;});void result.catch(()=>{});
  const server=createServer(async(req,res)=>{
   res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
   const respond=(status:number)=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8'});res.end(status===200?'Authorization checked. Return to YAPLIX.':'Authorization could not be verified. Return to YAPLIX.');};
   if(req.method!=='GET'||req.headers.host!==new URL(redirectUri).host||req.socket.remoteAddress!=='127.0.0.1'||req.headers.origin||req.headers['x-forwarded-host']||req.headers['x-forwarded-for']){respond(400);return;}
   const callback=new URL(req.url??'/',redirectUri);
   if(callback.origin!==new URL(redirectUri).origin||callback.pathname!=='/auth/callback'){respond(404);return;}
   if(claimed){respond(409);return;}claimed=true;
   try{
    for(const key of callback.searchParams.keys())if(callback.searchParams.getAll(key).length!==1)fail('SIWC_CALLBACK_INVALID');
    if(!same(callback.searchParams.get('state')??'',state))fail('SIWC_STATE_INVALID');
    if(callback.searchParams.has('error'))fail('SIWC_AUTH_DENIED');
    const code=callback.searchParams.get('code');if(!code||code.length>8192)fail('SIWC_CALLBACK_INVALID');
    const selected=this.#registration,clientId=callback.searchParams.get('client_id')??selected?.clientId;
    if(!clientId||!/^oaiapp_[A-Za-z0-9_-]{1,200}$/.test(clientId)||(selected&&clientId!==selected.clientId))fail('SIWC_CLIENT_INVALID');
    // Pending IDs are not trusted identities. Retain a new registration across
    // an expired code, but only activate it after signed identity validation.
    if(!selected)this.#saveRegistration({clientId,issuer:SIWC.issuer,subject:null});
    const tokens=await this.#json(SIWC.token,combined,new URLSearchParams({grant_type:'authorization_code',client_id:clientId,code,code_verifier:verifier,redirect_uri:redirectUri,resource:'https://api.openai.com/v1'}));
    if(!tokens||typeof tokens.scope!=='string'||!tokens.scope.split(' ').includes('chatgpt.tokens.use.direct'))fail('SIWC_PLAN_PERMISSION_REQUIRED');
    if(!SCOPE.split(' ').every(scope=>tokens.scope.split(' ').includes(scope)))fail('SIWC_SCOPES_REQUIRED');
    if(tokens.token_type?.toLowerCase()!=='bearer'||![tokens.id_token,tokens.access_token,tokens.refresh_token].every(v=>typeof v==='string'&&v.length>0&&v.length<32000)||!Number.isSafeInteger(tokens.expires_in)||tokens.expires_in<1||tokens.expires_in>86400)fail('SIWC_TOKEN_INVALID');
    let subject:string;
    const jwks=await this.#json(SIWC.jwks,combined);
    try{
     const {payload}=await jwtVerify(tokens.id_token,createLocalJWKSet(jwks),{issuer:SIWC.issuer,audience:clientId,algorithms:['RS256','ES256'],requiredClaims:['sub','exp','iat','nonce'],clockTolerance:5});
     if(typeof payload.sub!=='string'||!payload.sub||payload.nonce!==nonce||typeof payload.iat!=='number'||payload.iat>Date.now()/1000+5||(payload.azp!==undefined&&payload.azp!==clientId)||(Array.isArray(payload.aud)&&payload.aud.length>1&&payload.azp!==clientId)||(selected?.subject&&selected.subject!==payload.sub))fail('SIWC_ID_TOKEN_INVALID');
     subject=payload.sub;
    }catch{fail('SIWC_ID_TOKEN_INVALID');}
    if(combined.aborted)fail('SIWC_CANCELLED');
    this.#saveRegistration({clientId,issuer:SIWC.issuer,subject:subject!});
    this.#tokens={access:tokens.access_token,refresh:tokens.refresh_token,id:tokens.id_token,expiresAt:Date.now()+tokens.expires_in*1000};respond(200);resolveResult(this.status());
   }catch(error){respond(400);rejectResult(error instanceof SiwcError?error:new SiwcError('SIWC_AUTH_FAILED'));}
  });
  const abort=()=>rejectResult(new SiwcError('SIWC_CANCELLED'));
  combined.addEventListener('abort',abort,{once:true});
  try{
   if(combined.aborted)fail('SIWC_CANCELLED');
   const discovery=await this.#json(SIWC.discovery,combined);
   if(discovery.issuer!==SIWC.issuer||discovery.authorization_endpoint!==SIWC.authorize||discovery.token_endpoint!==SIWC.token||discovery.jwks_uri!==SIWC.jwks)fail('SIWC_DISCOVERY_INVALID');
   await new Promise<void>((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',()=>yes());});
   redirectUri='http://127.0.0.1:'+(server.address() as {port:number}).port+'/auth/callback';
   const authorization=new URL(SIWC.authorize);authorization.search=new URLSearchParams({client_id:this.#registration?.clientId??'dynamic_agent_client',...(!this.#registration?{agent_name_hint:'YAPLIX'}:{}),ext_agent_host_id:this.#host!,response_type:'code',redirect_uri:redirectUri,scope:SCOPE,resource:'https://api.openai.com/v1',state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}).toString();
   await Promise.race([this.#open(authorization.href),result]);
   return await result;
  }catch(error){this.#tokens=null;throw error instanceof SiwcError?error:new SiwcError('SIWC_AUTH_FAILED');}
  finally{
   combined.removeEventListener('abort',abort);controller.abort();state='';nonce='';verifier='';
   server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));
   if(lock)unlinkSync(lock);this.#active=null;
  }
 }
}

async function readSiwcStream(response:Response,signal:AbortSignal,report:SiwcProbeReport,maxTextBytes=8192){
 const maxFrameBytes=Math.max(65536,maxTextBytes*8),maxWireBytes=Math.max(1000000,maxTextBytes*32);
  const read=async(response:Response,consume:(text:string,done:boolean)=>boolean,inference=false)=>{
   const reader=response.body?.getReader();if(!reader)fail('SIWC_RESPONSE_INVALID');
   const decoder=new TextDecoder('utf-8',{fatal:true});let size=0;
   const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
   try{
    for(;;){signal.throwIfAborted();const next=await reader.read();signal.throwIfAborted();
     if(next.done){let tail:string;try{tail=decoder.decode();}catch{fail(inference?'SIWC_SSE_INVALID':'SIWC_MODELS_INVALID');}consume(tail,true);break;}
     size+=next.value.byteLength;if(inference)report.diagnostics.receivedBytes=size;
     if(size>maxWireBytes)fail('SIWC_RESPONSE_TOO_LARGE');
     let decoded:string;try{decoded=decoder.decode(next.value,{stream:true});}catch{fail(inference?'SIWC_SSE_INVALID':'SIWC_MODELS_INVALID');}
     if(consume(decoded,false))break;
    }
   }catch(error){if(inference&&!(error instanceof SiwcError)&&!signal.aborted)fail('SIWC_STREAM_INTERRUPTED');throw error;}
   finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});}
  };
   const mediaType=response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase();
   report.responseMediaType=!mediaType?'missing':mediaType==='text/event-stream'?'event-stream':mediaType==='application/json'?'json':'other';
   // Parse the actual wire frames; a missing/mislabelled media type alone is
   // neither success nor evidence that the body is not SSE. JSON cannot pass.
   let pending='',frame='',text='',nonSsePrefix='',completed=false;
   const parts=new Map<string,{output:number;content:number;delta:string;done?:string;final?:string}>();
   const part=(output:unknown,content:unknown)=>{
    const index=(value:unknown)=>{if(value===undefined)return 0;if(!Number.isSafeInteger(value)||Number(value)<0||Number(value)>10000)fail('SIWC_SSE_INVALID');return Number(value);};
    const o=index(output),c=index(content),key=o+':'+c;
    if(!parts.has(key)){if(parts.size>=128)fail('SIWC_RESPONSE_TOO_LARGE');parts.set(key,{output:o,content:c,delta:''});}
    return parts.get(key)!;
   };
   const updateText=()=>{
    text=[...parts.values()].sort((a,b)=>a.output-b.output||a.content-b.content).map(p=>p.final||p.done||p.delta).join('');
    report.textReceived=text.length>0;report.diagnostics.textPresent=report.textReceived;report.diagnostics.textLength=text.length;
    report.exactMatch=text==='YAPLIX READY';if(Buffer.byteLength(text)>maxTextBytes)fail('SIWC_OUTPUT_TOO_LARGE');
   };
   const metadata=(value:any)=>{
    const result=value?.response;
    if(result&&typeof result==='object'){
     if(Object.hasOwn(result,'model')&&result.model!==undefined){
      // Fixed labels only: arbitrary provider metadata may contain identity or credentials.
      const model=safeCode(result.model,[PROBE_MODEL,'gpt-6-astra'])??'OTHER';
      report.actualModel=report.actualModel===null||report.actualModel===model?model:'CONFLICT';
     }
     report.diagnostics.responseStatus=safeCode(result.status,['completed','failed','incomplete','in_progress','queued','cancelled']);
     report.diagnostics.incompleteReason=safeCode(result.incomplete_details?.reason,['max_output_tokens','content_filter']);
    }
    const code=result?.error?.code??value?.error?.code??(value?.type==='error'?value.code:undefined);
    if(code!==undefined)report.diagnostics.apiErrorCode=safeCode(code,API_CODES);
    const usage=result?.usage??value?.usage;
    if(usage&&typeof usage==='object'){
     const counts:Record<string,number>={};
     for(const key of ['input_tokens','output_tokens','total_tokens'])if(Number.isSafeInteger(usage[key])&&usage[key]>=0)counts[key]=usage[key];
     if(Object.keys(counts).length)report.usage=counts;
    }
   };
   const responseError=(code:unknown)=>fail(code==='subscription_sharing_usage_limit_exceeded'?'SIWC_USAGE_LIMIT':code==='subscription_sharing_usage_unavailable'?'SIWC_USAGE_UNAVAILABLE':'SIWC_INFERENCE_FAILED');
   const event=(frame:string)=>{
    const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');
    if(!data||data==='[DONE]')return false;
    let value:any;try{value=JSON.parse(data);}catch{fail('SIWC_SSE_INVALID');}
    if(typeof value?.type!=='string'||(!value.type.startsWith('response.')&&value.type!=='error'))fail('SIWC_SSE_INVALID');
    const known=STREAM_EVENTS.find(type=>type===value.type)??'unknown';
    report.diagnostics.eventCounts[known]=(report.diagnostics.eventCounts[known]??0)+1;
    report.diagnostics.lastEventType=known;metadata(value);
    report.sseObserved=true;nonSsePrefix='';
    if(value.type==='response.refusal.delta'||value.type==='response.refusal.done')fail('SIWC_REFUSAL');
    if(value.type==='response.failed'||value.type==='response.incomplete'||value.type==='error'){
     const code=value.response?.error?.code??value.error?.code??value.code;
     report.inference=value.type==='response.failed'?'FAILED':value.type==='response.incomplete'?'INCOMPLETE':'ERROR';
     if(value.type==='response.incomplete')fail('SIWC_INFERENCE_INCOMPLETE');
     responseError(code);
    }
    if(value.type==='response.output_text.delta'||value.type==='response.output_text.done'){
     const chunk=value.type==='response.output_text.delta'?value.delta:value.text;if(typeof chunk!=='string')fail('SIWC_SSE_INVALID');
     const target=part(value.output_index,value.content_index);
     if(value.type==='response.output_text.done')target.done=chunk;else target.delta+=chunk;
     updateText();
    }
    if(value.type!=='response.completed')return false;
    const result=value.response;if(result?.status!=='completed'||result.error)fail('SIWC_SSE_INVALID');
    report.inference='COMPLETED';
    if(Array.isArray(result.output))for(const [output,item] of result.output.entries()){
     if(item?.type!=='message'||item.role!=='assistant'||!Array.isArray(item.content))continue;
     for(const piece of item.content)if(piece?.type==='refusal')fail('SIWC_REFUSAL');
     for(const [content,piece] of item.content.entries())if(piece?.type==='output_text'&&typeof piece.text==='string'&&piece.text)part(output,content).final=piece.text;
    }
    updateText();
    if(!text){report.inference='COMPLETED_EMPTY';fail('SIWC_COMPLETED_WITHOUT_TEXT');}
    completed=true;return true;
   };
   await read(response,(text,done)=>{
    if(!report.sseObserved)nonSsePrefix=(nonSsePrefix+text).slice(0,65536);
    pending+=text;let newline:RegExpExecArray|null;
    while((newline=/\r\n|\r|\n/.exec(pending))){
     // Wait for the LF half of a CRLF split across network chunks.
     if(newline[0]==='\r'&&newline.index===pending.length-1&&!done)break;
     const line=pending.slice(0,newline.index);pending=pending.slice(newline.index+newline[0].length);
     if(line){frame+=line+'\n';if(frame.length>maxFrameBytes)fail('SIWC_RESPONSE_TOO_LARGE');}
     else{const finished=frame;frame='';if(event(finished))return true;}
    }
    if(frame.length+pending.length>maxFrameBytes)fail('SIWC_RESPONSE_TOO_LARGE');return false;
   },true);
   if(!report.sseObserved){
    // Distinguish a structured upstream error from a stream-format failure,
    // without exposing its message, body or arbitrary provider codes.
    let json:any;try{json=JSON.parse(nonSsePrefix);}catch{}
    if(json?.error){metadata(json);report.inference='ERROR';responseError(json.error.code);}
    fail('SIWC_SSE_REQUIRED');
   }
   if(!completed){report.inference='INTERRUPTED';fail('SIWC_STREAM_INTERRUPTED');}
   report.inference='COMPLETED';
   if(report.actualModel===null)fail('SIWC_MODEL_ACTUAL_NOT_VERIFIED');
   if(report.actualModel!==PROBE_MODEL)fail('SIWC_MODEL_ACTUAL_MISMATCH');
 return text;
}

const newStreamReport=():SiwcProbeReport=>({requestedModel:PROBE_MODEL,actualModel:null,result:'PARTIAL',authorization:'VERIFIED',planPermissionGranted:true,models:[],selectedModel:null,inference:'NOT_RUN',textReceived:false,exactMatch:false,usage:null,diagnostics:{eventCounts:{},lastEventType:null,responseStatus:null,apiErrorCode:null,incompleteReason:null,textPresent:false,textLength:0,receivedBytes:0},providerCalls:{modelsGet:0,inferencePost:0},tokensPersisted:false,error:null,httpStatus:null,responseMediaType:null,sseObserved:false,requestedReasoningEffort:'medium'});
