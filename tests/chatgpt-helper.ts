import {mkdtempSync} from 'node:fs';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {ChatGptSession} from '../src/chatgpt.ts';
import {SIWC} from '../src/experimental/siwc.ts';
import type {NetworkPolicy} from '../src/access.ts';
const keys=await generateKeyPair('RS256');
const jwk={...await exportJWK(keys.publicKey),kid:'offline',alg:'RS256',use:'sig'};
export const localPolicy:NetworkPolicy={mode:'local',host:'127.0.0.1',port:3210};
export const completed=(code:string,model:unknown='gpt-6.1-sol')=>({type:'response.completed',response:{status:'completed',model,output:[{type:'message',role:'assistant',content:[{type:'output_text',text:code}]}],usage:{output_tokens:123}}});
export const sse=(events:unknown[])=>new Response(events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join(''));
// Only the OpenAI HTTP and system-browser boundaries are synthetic. OAuth uses
// signed JWTs and the actual LocalSiwc loopback callback; no token injection.
export function offlineChatGpt(request:typeof fetch,policy=localPolicy,expires=3600,directory=mkdtempSync('.local/chatgpt-test-')){
 let authorization!:URL;
 const session=new ChatGptSession({...policy},{directory,timeoutMs:2000,request:async(input,init)=>{
  const url=String(input);
  if(url===SIWC.discovery)return Response.json({issuer:SIWC.issuer,authorization_endpoint:SIWC.authorize,token_endpoint:SIWC.token,jwks_uri:SIWC.jwks});
  if(url===SIWC.jwks)return Response.json({keys:[jwk]});
  if(url!==SIWC.token)return request(input,init);
  const token=await new SignJWT({nonce:authorization.searchParams.get('nonce')}).setProtectedHeader({alg:'RS256',kid:'offline'}).setIssuer(SIWC.issuer).setAudience('oaiapp_offline').setSubject('offline-subject').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
  return Response.json({access_token:'offline-access-credential',refresh_token:'offline-refresh-credential',id_token:token,token_type:'Bearer',expires_in:expires,scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'});
 },networkEnv:{YAPLIX_LLM_NETWORK:'direct'},openBrowser:async value=>{
  authorization=new URL(value);const callback=new URL(authorization.searchParams.get('redirect_uri')!);
  callback.search=new URLSearchParams({state:authorization.searchParams.get('state')!,code:'offline-code',client_id:'oaiapp_offline'}).toString();await fetch(callback);
 }});
 return{session,directory};
}
export async function connected(session:ChatGptSession){
 session.connect();await ready(session);
}
export async function ready(session:ChatGptSession){
 for(let i=0;i<200;i++){const state=session.status().state;if(state!=='CONNECTING'){if(state!=='CONNECTED')throw Error('OFFLINE_AUTH_FAILED');return;}await new Promise(r=>setTimeout(r,10));}throw Error('OFFLINE_AUTH_TIMEOUT');
}
