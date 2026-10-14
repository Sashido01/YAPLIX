import { createHmac, timingSafeEqual, randomBytes, createHash } from 'node:crypto';
import { Fault } from './contracts.ts';
import { boundedText } from './transport.ts';

export function validateInitData(raw:unknown,token:string,now=Math.floor(Date.now()/1000),maxAge=300){
  if(typeof raw!=='string'||!raw||raw.length>8192||!token)throw new Fault('TELEGRAM_AUTH_INVALID',401);
  const params=new URLSearchParams(raw),keys=[...params.keys()];
  if(new Set(keys).size!==keys.length||!params.has('auth_date')||!params.has('user'))throw new Fault('TELEGRAM_AUTH_INVALID',401);
  const supplied=params.get('hash')??'';if(!/^[0-9a-f]{64}$/.test(supplied))throw new Fault('TELEGRAM_AUTH_INVALID',401);
  params.delete('hash');
  const data=[...params.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+'='+v).join('\n');
  const secret=createHmac('sha256','WebAppData').update(token).digest();
  const expected=createHmac('sha256',secret).update(data).digest();
  if(!timingSafeEqual(expected,Buffer.from(supplied,'hex')))throw new Fault('TELEGRAM_AUTH_INVALID',401);
  const date=Number(params.get('auth_date'));if(!/^\d{10}$/.test(params.get('auth_date')!)||!Number.isSafeInteger(date)||date>now+30||now-date>maxAge)throw new Fault('TELEGRAM_AUTH_EXPIRED',401);
  let user;try{user=JSON.parse(params.get('user')!);}catch{throw new Fault('TELEGRAM_AUTH_INVALID',401);}
  if(!Number.isSafeInteger(user?.id)||user.id<=0)throw new Fault('TELEGRAM_AUTH_INVALID',401);
  return {userId:user.id};
}
export class TelegramSessions {
  private sessions=new Map<string,{userId:number;expires:number}>();private token:string;private allowed:Set<number>;private age:number;
  constructor(env:NodeJS.ProcessEnv=process.env){
    this.token=env.TELEGRAM_BOT_TOKEN??'';this.age=Number(env.TELEGRAM_AUTH_MAX_AGE??300);
    const ids=(env.TELEGRAM_ALLOWED_USER_IDS??'').split(',').map(s=>s.trim()).filter(Boolean);
    if(ids.some(s=>!/^\d+$/.test(s)||!Number.isSafeInteger(Number(s))||Number(s)<=0)||!Number.isSafeInteger(this.age)||this.age<30||this.age>900)throw new Fault('INVALID_TELEGRAM_CONFIGURATION');
    this.allowed=new Set(ids.map(Number));
  }
  configured(){return Boolean(this.token&&this.allowed.size);}
  singleOwner(){return Boolean(this.token&&this.allowed.size===1);}
  multipleOwners(){return this.allowed.size>1;}
  async notifyReady(owner:string,gameId:string,versionId:string,origin?:string):Promise<'sent'|'unavailable'|'unknown'>{
    if(!this.singleOwner()||!/^\d+$/.test(owner)||!this.allowed.has(Number(owner))||!origin||!origin.startsWith('https://'))return'unavailable';
    const url=new URL('/telegram',origin);url.searchParams.set('game',gameId);url.searchParams.set('version',versionId);
    try{const response=await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:Number(owner),text:'Ваша игра YAPLIX готова.',reply_markup:{inline_keyboard:[[{text:'Открыть игру',web_app:{url:url.href}}]]}})});if(!response.ok){await response.body?.cancel();return'unavailable';}const data=JSON.parse(await boundedText(response,16000));if(data.ok===false)return'unavailable';return data.ok===true&&Number.isSafeInteger(data.result?.message_id)&&data.result.message_id>0&&data.result?.chat?.id===Number(owner)?'sent':'unknown';}catch{return'unknown';}
  }
  login(raw:unknown){
    if(!this.configured())throw new Fault('TELEGRAM_NOT_CONFIGURED',503);
    const {userId}=validateInitData(raw,this.token,undefined,this.age);if(!this.allowed.has(userId))throw new Fault('TELEGRAM_USER_FORBIDDEN',403);
    const now=Date.now();for(const[id,s]of this.sessions)if(s.expires<=now)this.sessions.delete(id);
    if(this.sessions.size>=1000)throw new Fault('ACCESS_SESSION_LIMIT',503);
    const id=randomBytes(32).toString('hex');this.sessions.set(createHash('sha256').update(id).digest('hex'),{userId,expires:now+3600000});
    return {sessionToken:id,cookie:`yaplix_telegram=${id}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=3600`};
  }
  user(cookie='',header?:string){
    const value=header??cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('yaplix_telegram='))?.slice(16);
    if(!value||!/^[0-9a-f]{64}$/.test(value))return;
    const session=this.sessions.get(createHash('sha256').update(value).digest('hex'));
    return session&&session.expires>Date.now()?session.userId:undefined;
  }
}
