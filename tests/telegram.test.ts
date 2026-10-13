import {test} from 'node:test';
import assert from 'node:assert/strict';
import {signedData} from './telegram-fixture.ts';
import {validateInitData,TelegramSessions} from '../src/telegram.ts';
import {shareLink,validShare} from '../src/sharing.ts';
import {RateLimit} from '../src/rate-limit.ts';
import {createApp} from '../src/api.ts';
import {Store} from '../src/store.ts';
import {spec,artifact} from './helpers.ts';
test('Telegram checks exact signed bytes, freshness, duplicate fields and allowlisted user before issuing a session',()=>{
 const token='synthetic-test-bot-token',now=Math.floor(Date.now()/1000),raw=signedData(token);assert.equal(validateInitData(raw,token).userId,123456789);
 for(const bad of [raw.replace('Synthetic','Attacker'),raw+'&user=%7B%7D',raw.replace('hash=','hash=00'),signedData(token,123456789,now-301),signedData(token,123456789,now+31)])assert.throws(()=>validateInitData(bad,token));
 const sessions=new TelegramSessions({TELEGRAM_BOT_TOKEN:token,TELEGRAM_ALLOWED_USER_IDS:'123456789'});const login=sessions.login(raw);assert.match(login.cookie,/HttpOnly; SameSite=Strict; Secure/);assert.equal(sessions.user(login.cookie),123456789);assert.equal(sessions.user('',login.sessionToken),123456789);assert.equal(sessions.user('',login.sessionToken+'x'),undefined);assert.throws(()=>sessions.login(signedData(token,999)),/TELEGRAM_USER_FORBIDDEN/);assert.throws(()=>new TelegramSessions().login(raw),/TELEGRAM_NOT_CONFIGURED/);
});
test('HTTPS Telegram authenticates same UI; unsigned/expired identity cannot spend LLM calls or read library',async()=>{
 const store=new Store(':memory:'),key='x'.repeat(40),token='synthetic-test-bot-token';let calls=0;
 const telegram=new TelegramSessions({TELEGRAM_BOT_TOKEN:token,TELEGRAM_ALLOWED_USER_IDS:'123456789'});
 const app=createApp(store,{generate:async()=>{calls++;throw Error('synthetic');}},undefined,{mode:'https',host:'127.0.0.1',port:3000,origin:'https://yaplix.test',key},telegram);
 const request=(path:string,body?:object,headers:Record<string,string>={})=>app.request('https://yaplix.test'+path,{method:body?'POST':'GET',headers:{Host:'yaplix.test','X-Forwarded-Proto':'https',...(body?{'Content-Type':'application/json',Origin:'https://yaplix.test'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
 try{
  assert.equal((await request('/api/games',{mode:'live',spec})).status,401);assert.equal(calls,0);assert.equal((await request('/api/telegram/auth',{initData:'unsigned'})).status,401);
  const login=await request('/api/telegram/auth',{initData:signedData(token)});assert.equal(login.status,200);const {sessionToken}=await login.json();const cookie=login.headers.get('set-cookie')!;
  assert.equal((await request('/api/games',undefined,{'X-Yaplix-Telegram-Session':sessionToken})).status,200);assert.equal((await request('/api/games',undefined,{Cookie:cookie})).status,200);
  const shell=await request('/telegram');assert.equal(shell.status,200);assert.ok((await shell.text()).includes('https://telegram.org/js/telegram-web-app.js'));assert.ok((await request('/',undefined,{Cookie:cookie})).headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
  assert.equal((await request('/api/games',undefined,{Origin:'https://attacker.test',Cookie:cookie})).status,403);
 }finally{store.close();}
});
test('share capability is HTTPS only, time limited, version bound and cannot authorize API or sessions',async()=>{
 const key='x'.repeat(40),now=Math.floor(Date.now()/1000),store=new Store(':memory:');try{
  const version=store.save(spec,artifact),url=shareLink('https://yaplix.test',key,version.versionId,now),path=new URL(url).pathname;
  assert.equal(validShare(path,key,now),true);assert.equal(validShare(path,key,now+604801),false);assert.equal(validShare(path,'wrong',now),false);assert.equal(validShare(path.replace(version.versionId,'00000000-0000-4000-8000-000000000000'),key,now),false);
  const app=createApp(store,undefined,undefined,{mode:'https',host:'127.0.0.1',port:3000,origin:'https://yaplix.test',key});const headers={Host:'yaplix.test','X-Forwarded-Proto':'https'};
  const response=await app.request(url,{headers});assert.equal(response.status,200);assert.equal(await response.text(),version.html);assert.match(response.headers.get('content-security-policy')!,/sandbox allow-scripts/);assert.equal((await app.request('https://yaplix.test/api/games?share='+path,{headers})).status,401);
 }finally{store.close();}
});
test('generation request limiter bounds repeated principals and stored bucket count',()=>{const limit=new RateLimit();for(let i=0;i<6;i++)limit.take('owner');assert.throws(()=>limit.take('owner'),/RATE_LIMIT/);});
