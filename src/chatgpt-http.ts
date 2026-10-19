import {Agent,ProxyAgent} from 'undici';
import type {Dispatcher} from 'undici';
import {networkRoute} from './llm-network.ts';
import {LIVE_RESPONSE_TIMEOUT_MS} from './generation-timeouts.ts';

export const CHATGPT_HTTP_OPTIONS=Object.freeze({connections:1,pipelining:1,connect:Object.freeze({timeout:10_000}),headersTimeout:LIVE_RESPONSE_TIMEOUT_MS,bodyTimeout:LIVE_RESPONSE_TIMEOUT_MS});
// Per-request dispatcher: includes delayed headers and silent SSE bodies. The
// absolute deadline also bounds keepalive bytes; connection/TLS stays at 10 s.
export async function chatGptRequest<T>(request:typeof fetch,url:string,init:RequestInit,consume:(response:Response,signal:AbortSignal)=>Promise<T>){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),LIVE_RESPONSE_TIMEOUT_MS);
 const signal=AbortSignal.any([controller.signal,...(init.signal?[init.signal]:[])]);
 let dispatcher:Dispatcher|undefined;
 try{
  const selected=networkRoute(new URL(url));
  const options=CHATGPT_HTTP_OPTIONS;
  if(selected.proxy){
   const proxy=new URL(selected.proxy),token=proxy.username||proxy.password?'Basic '+Buffer.from(decodeURIComponent(proxy.username)+':'+decodeURIComponent(proxy.password)).toString('base64'):undefined;
   proxy.username='';proxy.password='';
   dispatcher=new ProxyAgent({...options,uri:proxy.href,token,proxyTls:{timeout:10_000},requestTls:{timeout:10_000}});
  }else dispatcher=new Agent(options);
  signal.throwIfAborted();
  const response=await request(url,{...init,signal,dispatcher} as RequestInit&{dispatcher:Dispatcher});
  return await consume(response,signal);
 }finally{clearTimeout(timer);controller.abort();await dispatcher?.destroy().catch(()=>{});}
}
