import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NetworkInterfaceInfo } from 'node:os';
import { phoneAddresses, lanAddresses } from '../src/network.ts';
import { PhoneConnection, PHONE_TTL, phonePort } from '../src/phone.ts';
import { createApp } from '../src/api.ts';
import { Store } from '../src/store.ts';
import { artifact, spec } from './helpers.ts';
import { connectionQr } from '../src/qr.ts';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { networkPolicy } from '../src/access.ts';

const entry = (address:string, internal=false) => [{address,internal,family:'IPv4',netmask:'255.255.255.0',mac:'01:02:03:04:05:06',cidr:address+'/24'}] as NetworkInterfaceInfo[];
test('phone networks exclude virtual, loopback, public, IPv6 and inactive adapters; multiple physical networks require a choice',()=>{
  const interfaces={Tailscale:entry('10.0.0.1'),Docker:entry('172.17.0.1'),WiFi:entry('192.168.2.5'),Ethernet:entry('10.1.1.4'),WSL:entry('172.20.1.1'),Loopback:entry('127.0.0.1',true),Public:entry('8.8.8.8'),'Ethernet down':entry('10.2.1.4'),'Ethernet duplicate':entry('10.1.1.4'),'Ethernet IPv6':[{...entry('10.1.1.4')[0],family:'IPv6',address:'::1'}] as NetworkInterfaceInfo[]};
  assert.deepEqual(phoneAddresses(interfaces,['WiFi','Ethernet','Tailscale','Docker','WSL']),[{name:'WiFi',address:'192.168.2.5'},{name:'Ethernet',address:'10.1.1.4'}]);
  assert.deepEqual(phoneAddresses(interfaces,[]),[]);
  assert.equal(phoneAddresses({mystery:entry('10.0.0.2')}).length,0);
  assert.deepEqual(phoneAddresses({'Ethernet 3':entry('192.168.56.1'),WiFi:entry('192.168.0.3')},['WiFi']),[{name:'WiFi',address:'192.168.0.3'}]);
});
test('phone QR requires an exact private URL, bounded token fragment and no query credentials',()=>{
  const url='http://192.168.0.3:45678/phone#'+'a'.repeat(43);
  assert.match(connectionQr(url,false,true),/<svg/);
  for(const bad of [url.replace('/phone','/admin'),url.replace('192.168.0.3','8.8.8.8'),url.replace('#','?token='),url+'x',url.replace('http:','https:'),url.replace('192.168.0.3','secret@192.168.0.3')])assert.throws(()=>connectionQr(bad,false,true));
});
test('phone startup fails closed for no network, multiple networks, unknown version and unavailable bind',async()=>{
  const store=new Store(':memory:'),version=store.save(spec,artifact),none=new PhoneConnection(store,async()=>[],Date.now,undefined,0),many=new PhoneConnection(store,async()=>[{name:'WiFi',address:'192.168.0.1'},{name:'Ethernet',address:'10.0.0.1'}],Date.now,undefined,0);
  try{
    await assert.rejects(none.enable(version.versionId),/PHONE_NO_NETWORK/);
    await assert.rejects(many.enable(version.versionId),/PHONE_CHOOSE_NETWORK/);
    await assert.rejects(many.enable(version.versionId,'10.1.0.1'),/HOST_NOT_AVAILABLE/);
    await assert.rejects(many.enable('00000000-0000-4000-8000-000000000000'),/VERSION_NOT_FOUND/);
    const absent=new PhoneConnection(store,async()=>[{name:'WiFi',address:'192.168.255.254'}],Date.now,undefined,0);
    await assert.rejects(absent.enable(version.versionId),/HOST_NOT_AVAILABLE|SERVER_LISTEN_FAILED|PHONE_SERVER_UNREACHABLE/);
    assert.deepEqual(absent.status(),{enabled:false});assert.throws(()=>absent.qr(),/PHONE_ACCESS_EXPIRED/);
  }finally{await none.close();await many.close();store.close();}
});
test('real private-IP listener shares exact game bytes, denies owner APIs, expires, refreshes and revokes without writes',async t=>{
  const host=lanAddresses()[0]?.address;if(!host){t.skip('No private IPv4 available');return;}
  const store=new Store(':memory:'),version=store.save(spec,artifact),other=store.save({...spec,prompt:'Other private game'},artifact);let now=Date.now();
  const phone=new PhoneConnection(store,async()=>[{name:'test-client',address:host}],()=>now,undefined,0),owner=createApp(store,undefined,undefined,undefined,undefined,undefined,undefined,phone);
  const headers={'Content-Type':'application/json'},before=store.list();
  try{
    assert.equal((await owner.request('/api/phone',{method:'POST',headers:{...headers,Origin:'null'},body:JSON.stringify({versionId:version.versionId})})).status,403);
    let state=await(await owner.request('/api/phone',{method:'POST',headers,body:JSON.stringify({versionId:version.versionId})})).json();
    assert.equal(state.enabled,true);const url=new URL(state.url),base=url.origin;
    assert.equal(url.pathname,'/phone');assert.equal(url.search,'');assert.ok(Number(url.port)>0);
    assert.equal((await fetch(base+'/phone')).status,200);assert.equal((await fetch(base+'/phone/version')).status,401);
    const redeem=(token:string,origin=base)=>fetch(base+'/phone/access',{method:'POST',headers:{Origin:origin},body:token});
    assert.equal((await redeem(url.hash.slice(1),'null')).status,403);assert.equal((await redeem('wrong')).status,401);
    assert.equal((await redeem('x'.repeat(65))).status,401);
    const access=await redeem(url.hash.slice(1)),cookie=access.headers.get('set-cookie')!.split(';')[0];assert.equal(access.status,200);assert.match(access.headers.get('set-cookie')!,/HttpOnly; SameSite=Strict/);
    const got=await(await fetch(base+'/phone/version',{headers:{Cookie:cookie}})).json();assert.equal(got.html,version.html);assert.equal(got.versionId,version.versionId);assert.equal(got.gameId,undefined);
    for(const path of ['/api/games','/api/jobs','/api/diagnostics','/api/backups','/.env','/.local/data.sqlite','/api/runtime/shutdown','/api/versions/'+other.versionId,'/phone/version?x=1']){
      if(path.includes('?'))continue;
      assert.equal((await fetch(base+path,{headers:{Cookie:cookie}})).status,403,path);
    }
    assert.equal((await fetch(base+'/phone/version',{method:'POST',headers:{Cookie:cookie}})).status,403);
    for(const more of ([{Origin:'null'},{Origin:'https://attacker.invalid'},{'X-Forwarded-For':'127.0.0.1'},{'Sec-Fetch-Site':'cross-site'}] as Record<string,string>[]))assert.equal((await fetch(base+'/phone/version',{headers:{Cookie:cookie,...more}})).status,403,JSON.stringify(more));
    // undici fetch ignores a custom Host; use an actual HTTP header on the wire.
    assert.equal(await new Promise<number|undefined>((done,fail)=>{const req=request(base+'/phone/version',{headers:{Host:'attacker.invalid',Cookie:cookie}},res=>{res.resume();done(res.statusCode);});req.on('error',fail);req.end();}),403);
    assert.ok((phone.status() as {lastOpenedAt:number}).lastOpenedAt);
    now+=PHONE_TTL+1;assert.equal((await fetch(base+'/phone/version',{headers:{Cookie:cookie}})).status,401);assert.throws(()=>phone.qr(),/PHONE_ACCESS_EXPIRED/);
    state=await phone.enable(other.versionId,host);const refreshed=new URL((state as {url:string}).url);assert.notEqual(refreshed.hash,url.hash);
    assert.equal((await fetch(refreshed.origin+'/phone/access',{method:'POST',body:url.hash.slice(1)})).status,401);
    await phone.disable();assert.deepEqual(phone.status(),{enabled:false});await assert.rejects(fetch(refreshed.origin+'/phone'));
    assert.deepEqual(store.list(),before);assert.equal(store.getVersion(version.versionId).sha256,version.sha256);assert.equal(store.analytics(version.versionId).sessionCount,0);
  }finally{await phone.close();store.close();}
});
test('saved LIVE evidence is separate from catalogue health and contains no source or other-provider history',()=>{
  const store=new Store(':memory:');try{
    store.save(spec,artifact);assert.equal(store.lastSavedGeneration('ollama.com'),null);
    const live=store.save(spec,{...artifact,method:'llm_code',provider:'ollama.com',model:'gemma4:31b',validationStatus:'passed'});
    assert.deepEqual(store.lastSavedGeneration('ollama.com'),{provider:'ollama.com',model:'gemma4:31b',createdAt:live.createdAt,source:'saved-version'});
    assert.equal(store.lastSavedGeneration('openrouter'),null);
  }finally{store.close();}
});
test('failed HTTP probe closes a bound listener and exposes no QR; busy and shutdown cannot leave a late listener',async t=>{
  const host=lanAddresses()[0]?.address;if(!host){t.skip('No private IPv4');return;}
  const store=new Store(':memory:'),v=store.save(spec,artifact);let origin='';
  const phone=new PhoneConnection(store,async()=>[{name:'WiFi',address:host}],Date.now,async value=>{origin=value;return false;},0);
  let release!:()=>void;const held=new Promise<void>(done=>release=done),busy=new PhoneConnection(store,async()=>{await held;return[{name:'WiFi',address:host}];},Date.now,undefined,0);
  try{
    await assert.rejects(phone.enable(v.versionId),/PHONE_SERVER_UNREACHABLE/);assert.deepEqual(phone.status(),{enabled:false});assert.throws(()=>phone.qr());await assert.rejects(fetch(origin+'/phone'));
    const pending=busy.enable(v.versionId);await assert.rejects(busy.enable(v.versionId),/PHONE_BUSY/);await assert.rejects(busy.disable(),/PHONE_BUSY/);
    await busy.shutdown();release();await assert.rejects(pending,/PHONE_SERVER_STOPPED/);assert.deepEqual(busy.status(),{enabled:false});
    await assert.rejects(busy.enable(v.versionId),/PHONE_SERVER_STOPPED/);
  }finally{release();await phone.close();await busy.close();store.close();}
});
test('full LAN/HTTPS owner sessions cannot manage local phone sharing',async()=>{
  const store=new Store(':memory:'),phone=new PhoneConnection(store,async()=>[],Date.now,undefined,0),key='s'.repeat(43);
  try{for(const mode of ['lan','https']){
    const policy=networkPolicy(mode==='lan'?{YAPLIX_MODE:mode,YAPLIX_HOST:'192.168.1.2',YAPLIX_ACCESS_KEY:key}:{YAPLIX_MODE:mode,PUBLIC_URL:'https://owner.invalid',YAPLIX_ACCESS_KEY:key});
    const app=createApp(store,undefined,undefined,policy,undefined,undefined,undefined,phone),base=policy.origin!;const proxy:Record<string,string>=mode==='https'?{'X-Forwarded-Proto':'https'}:{};
    const login=await app.request(base+'/api/access',{method:'POST',headers:{...proxy,'Content-Type':'application/json'},body:JSON.stringify({key})});
    const cookie=login.headers.get('set-cookie')!;
    for(const [path,method] of [['/api/phone','GET'],['/api/phone','POST'],['/api/phone','DELETE'],['/api/phone/qr.svg','GET']])assert.equal((await app.request(base+path,{method,headers:{...proxy,Cookie:cookie,'Content-Type':'application/json'},...(method==='GET'?{}:{body:'{}'})})).status,403);
  }}finally{await phone.close();store.close();}
});


test('production phone port defaults to 52604 and accepts only explicit fixed TCP ports',()=>{
  assert.equal(phonePort({}),52604);
  assert.equal(phonePort({YAPLIX_PHONE_PORT:'53000'}),53000);
  for(const value of ['', '0', '-1', '65536', '1.5', 'abc', ' 52604', '5e4'])
    assert.throws(()=>phonePort({YAPLIX_PHONE_PORT:value}),/PHONE_PORT_INVALID/);
});


test('fixed listener port survives QR rotation, disable/re-enable and a new connection instance',async()=>{
  const store=new Store(':memory:'),version=store.save(spec,artifact);
  const addresses=async()=>[{name:'isolated test',address:'127.0.0.1'}];
  const reservation=createServer();
  await new Promise<void>(r=>reservation.listen(0,'127.0.0.1',r));
  const port=(reservation.address() as {port:number}).port;
  await new Promise<void>(r=>reservation.close(()=>r()));
  // Allocated by the OS, never the shared production 52604.
  const phone=new PhoneConnection(store,addresses,Date.now,undefined,port);
  const restarted=new PhoneConnection(store,addresses,Date.now,undefined,port);
  const token=(url:URL)=>fetch(url.origin+'/phone/access',{method:'POST',headers:{Origin:url.origin},body:url.hash.slice(1)});
  try{
    const first=new URL((await phone.enable(version.versionId) as {url:string}).url);
    assert.equal(Number(first.port),port);
    const access=await token(first),cookie=access.headers.get('set-cookie')!.split(';')[0];
    assert.equal(access.status,200);
    const fresh=new URL((await phone.enable(version.versionId) as {url:string}).url);
    assert.equal(fresh.origin,first.origin);assert.notEqual(fresh.hash,first.hash);
    assert.equal((await token(first)).status,401);
    assert.equal((await fetch(fresh.origin+'/phone/version',{headers:{Cookie:cookie}})).status,401);
    const newAccess=await token(fresh),newCookie=newAccess.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await(await fetch(fresh.origin+'/phone/version',{headers:{Cookie:newCookie}})).json()).versionId,version.versionId);
    await phone.disable();await assert.rejects(fetch(first.origin+'/phone'));
    const again=new URL((await phone.enable(version.versionId) as {url:string}).url);
    assert.equal(again.port,first.port);assert.notEqual(again.hash,fresh.hash);
    await phone.shutdown();
    const afterRestart=new URL((await restarted.enable(version.versionId) as {url:string}).url);
    assert.equal(afterRestart.port,first.port);assert.notEqual(afterRestart.hash,again.hash);
  }finally{await phone.close();await restarted.close();store.close();}
});


test('occupied fixed port reports PORT_IN_USE, exposes no QR and never falls back',async()=>{
  const store=new Store(':memory:'),version=store.save(spec,artifact),blocker=createServer();
  await new Promise<void>(r=>blocker.listen(0,'127.0.0.1',r));
  const port=(blocker.address() as {port:number}).port;
  const phone=new PhoneConnection(store,async()=>[{name:'isolated test',address:'127.0.0.1'}],Date.now,undefined,port);
  try{
    await assert.rejects(phone.enable(version.versionId),/PORT_IN_USE/);
    assert.deepEqual(phone.status(),{enabled:false});assert.throws(()=>phone.qr(),/PHONE_ACCESS_EXPIRED/);
    assert.equal(blocker.listening,true);
    await new Promise<void>(r=>blocker.close(()=>r()));
    assert.equal(new URL((await phone.enable(version.versionId) as {url:string}).url).port,String(port));
  }finally{await phone.close();if(blocker.listening)await new Promise<void>(r=>blocker.close(()=>r()));store.close();}
});
