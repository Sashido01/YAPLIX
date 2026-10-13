import { createHmac, timingSafeEqual } from 'node:crypto';
import { uuid, Fault } from './contracts.ts';
const ttl=7*86400;
function signature(key:string,id:string,expires:number){return createHmac('sha256',key).update('YAPLIX:read-only-share:v1:'+id+':'+expires).digest('hex');}
export function shareLink(origin:string,key:string,id:string,now=Math.floor(Date.now()/1000)){
  if(!origin.startsWith('https://'))throw new Fault('HTTPS_SHARE_REQUIRED',409);
  id=uuid(id);const expires=now+ttl;return origin+'/play/'+id+'/'+expires+'/'+signature(key,id,expires);
}
export function validShare(path:string,key:string,now=Math.floor(Date.now()/1000)){
  const match=/^\/play\/([0-9a-f-]{36})\/(\d{10})\/([0-9a-f]{64})$/.exec(path);if(!match)return false;
  try{const id=uuid(match[1]),expires=Number(match[2]);return expires>=now&&expires<=now+ttl&&timingSafeEqual(Buffer.from(match[3],'hex'),Buffer.from(signature(key,id,expires),'hex'));}catch{return false;}
}
