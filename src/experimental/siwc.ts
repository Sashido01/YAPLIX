// Independent implementation of the documented SIWC public-client protocol.
// Standalone feasibility only: no generator, API route, inference or token files.
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:http';
import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {dirname,isAbsolute,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalJWKSet,jwtVerify} from 'jose';

export const SIWC=Object.freeze({issuer:'https://auth.openai.com',discovery:'https://auth.openai.com/.well-known/openid-configuration',authorize:'https://auth.openai.com/api/accounts/authorize',token:'https://auth.openai.com/api/accounts/oauth/token',jwks:'https://auth.openai.com/.well-known/jwks.json'});
const SCOPE='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const moduleRoot=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const root=existsSync(resolve(moduleRoot,'package.json'))?moduleRoot:resolve(moduleRoot,'..');
type Registration={clientId:string;subject:string|null;issuer:typeof SIWC.issuer};
type Status={connected:boolean;planPermissionGranted:boolean;registered:boolean};
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
 #directory:string;#request:typeof fetch;#open:(url:string)=>Promise<void>;#timeout:number;
 #host:string|null=null;#registration:Registration|null=null;#tokens:{access:string;refresh:string;id:string;expiresAt:number}|null=null;
 #active:AbortController|null=null;
 constructor(options:{directory?:string;request?:typeof fetch;openBrowser:(url:string)=>Promise<void>;timeoutMs?:number}){
  this.#directory=resolve(options.directory??resolve(root,'.local/siwc-feasibility'));
  this.#request=options.request??fetch;this.#open=options.openBrowser;this.#timeout=options.timeoutMs??180000;
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
 dispose(){this.#active?.abort();this.#tokens=null;}
 #saveRegistration(value:Registration){
  const path=resolve(this.#directory,'registration.json'),temporary=path+'.'+randomUUID()+'.tmp';
  try{writeFileSync(temporary,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});renameSync(temporary,path);this.#registration=value;}
  catch{fail('SIWC_STORAGE_UNAVAILABLE');}finally{if(existsSync(temporary))unlinkSync(temporary);}
 }
 async #json(url:string,signal:AbortSignal,body?:URLSearchParams):Promise<any>{
  if(url!==SIWC.discovery&&url!==SIWC.jwks&&url!==SIWC.token)fail('SIWC_ENDPOINT_REJECTED');
  try{
   const response=await this.#request(url,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),headers:{Accept:'application/json',...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(body?{body:body.toString()}:{})});
   if(!response.ok){await response.body?.cancel();fail(body?'SIWC_TOKEN_REJECTED':'SIWC_NETWORK');}
   const reader=response.body?.getReader();if(!reader)fail('SIWC_RESPONSE_INVALID');let size=0;const chunks:Uint8Array[]=[];
   try{for(;;){const next=await reader!.read();if(next.done)break;size+=next.value.byteLength;if(size>100000)fail('SIWC_RESPONSE_TOO_LARGE');chunks.push(next.value);}}finally{await reader!.cancel().catch(()=>{});}
   return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }catch(error){if(error instanceof SiwcError)throw error;fail(signal.aborted?'SIWC_CANCELLED':'SIWC_NETWORK');}
 }
 async signIn(signal?:AbortSignal):Promise<Status>{
  if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')fail('SIWC_INSECURE_TLS');
  if(this.#active)fail('SIWC_BUSY');this.prepare();
  const lock=resolve(this.#directory,'authorization.lock');
  try{writeFileSync(lock,'pending\n',{flag:'wx',mode:0o600});}catch{fail('SIWC_BUSY');}
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
   unlinkSync(lock);this.#active=null;
  }
 }
}
