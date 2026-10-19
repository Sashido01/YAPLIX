import {longChatGpt} from './chatgpt-timeouts.ts';
import {spawn} from 'node:child_process';
import {LocalSiwc,SiwcError} from './experimental/siwc.ts';
import {Fault,MAX_HTML_BYTES} from './contracts.ts';
import type {NetworkPolicy} from './access.ts';
import {ProviderFailure} from './transport.ts';
import type {CodeTransport,Message,GenerationContext} from './transport.ts';

export const CHATGPT_MODEL='gpt-6.1-sol';
type State='DISCONNECTED'|'CONNECTING'|'CONNECTED'|'EXPIRED'|'ERROR';
async function openBrowser(url:string){
 await new Promise<void>((yes,no)=>{
  const child=spawn(process.platform==='win32'?'rundll32.exe':'xdg-open',process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url],{stdio:'ignore',windowsHide:true});
  child.once('error',()=>no(new SiwcError('SIWC_BROWSER_UNAVAILABLE')));
  child.once('exit',code=>code===0?yes():no(new SiwcError('SIWC_BROWSER_UNAVAILABLE')));
 });
}
export class ChatGptSession {
 #auth:LocalSiwc;#policy:NetworkPolicy;#state:State='DISCONNECTED';#error:string|null=null;#pending?:Promise<void>;#epoch=0;
 constructor(policy:NetworkPolicy,options?:ConstructorParameters<typeof LocalSiwc>[0]){
  this.#policy=policy;this.#auth=new LocalSiwc({...options,openBrowser:options?.openBrowser??openBrowser,authorizationLock:'process'});
 }
 available(){return this.#policy.mode==='local'&&this.#policy.host==='127.0.0.1';}
 status(){
  if(this.#state==='CONNECTED'&&!this.#auth.status().connected){this.#state='EXPIRED';this.#auth.dispose();}
  return{available:this.available(),state:this.#state,connected:this.available()&&this.#state==='CONNECTED',model:CHATGPT_MODEL,reauthorizationRequired:this.#state==='EXPIRED'||this.#state==='ERROR',error:this.#error};
 }
 assertConnected(){if(!this.available())throw new Fault('CHATGPT_LOCAL_ONLY',403);if(!this.status().connected)throw new Fault('CHATGPT_AUTH_REQUIRED',409);}
 connect(){
  if(!this.available())throw new Fault('CHATGPT_LOCAL_ONLY',403);
  if(this.#pending||this.status().connected)throw new Fault('CHATGPT_BUSY',409);
  this.#state='CONNECTING';this.#error=null;const epoch=++this.#epoch;
  this.#pending=this.#auth.signIn().then(()=>{if(epoch===this.#epoch)this.#state='CONNECTED';}).catch(()=>{if(epoch===this.#epoch){this.#auth.dispose();this.#state='ERROR';this.#error='CHATGPT_AUTH_FAILED';}}).finally(()=>{this.#pending=undefined;});
  return this.status();
 }
 disconnect(){++this.#epoch;this.#auth.dispose();this.#state='DISCONNECTED';this.#error=null;return this.status();}
 async respond(messages:Message[],signal:AbortSignal,beforePost:()=>void,longWait=false){
  this.assertConnected();
  try{return await this.#auth.respond(messages,signal,()=>{this.assertConnected();beforePost();},MAX_HTML_BYTES,longWait);}
  catch(error){if(!this.#auth.status().connected){this.#state='EXPIRED';this.#error='CHATGPT_AUTH_REQUIRED';}throw error;}
 }
}
export class ChatGptTransport implements CodeTransport {
 readonly route='primary' as const;readonly provider='chatgpt';readonly model=CHATGPT_MODEL;readonly observesDispatch=true;
 #session:ChatGptSession;
 constructor(session:ChatGptSession){this.#session=session;}
 async readiness(){return this.#session.status().connected?'ready':'auth_required';}
 async complete(messages:Message[],signal:AbortSignal,context?:GenerationContext){
  // Legacy synchronous endpoints cannot spend a personal-account budget.
  if(!context?.durableJob)throw new Fault('CHATGPT_JOB_REQUIRED',409);
  try{return await this.#session.respond(messages,signal,()=>context.dispatch(this),longChatGpt(context));}
  catch(error){throw error instanceof Fault?error:new ProviderFailure(error instanceof SiwcError?error.message:'SIWC_NETWORK');}
 }
}
