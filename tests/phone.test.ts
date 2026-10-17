import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NetworkInterfaceInfo } from 'node:os';
import { phoneAddresses, lanAddresses, windowsPhoneAddresses } from '../src/network.ts';
import { PhoneConnection, PHONE_TTL, configuredPhonePort } from '../src/phone.ts';
import { createApp } from '../src/api.ts';
import { Store } from '../src/store.ts';
import { artifact, spec } from './helpers.ts';
import { connectionQr } from '../src/qr.ts';
import { request } from 'node:http';
import { networkPolicy } from '../src/access.ts';
import { createServer } from 'node:net';

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
  const store=new Store(':memory:'),version=store.save(spec,artifact),none=new PhoneConnection(store,async()=>[]),many=new PhoneConnection(store,async()=>[{name:'WiFi',address:'192.168.0.1'},{name:'Ethernet',address:'10.0.0.1'}]);
  try{
    await assert.rejects(none.enable(version.versionId),/PHONE_NO_NETWORK/);
    await assert.rejects(many.enable(version.versionId),/PHONE_CHOOSE_NETWORK/);
    await assert.rejects(many.enable(version.versionId,'10.1.0.1'),/HOST_NOT_AVAILABLE/);
    await assert.rejects(many.enable('00000000-0000-4000-8000-000000000000'),/VERSION_NOT_FOUND/);
    const absent=new PhoneConnection(store,async()=>[{name:'WiFi',address:'192.168.255.254'}]);
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
  let release!:()=>void;const held=new Promise<void>(done=>release=done),busy=new PhoneConnection(store,async()=>{await held;return[{name:'WiFi',address:host}];},undefined,undefined,0);
  try{
    await assert.rejects(phone.enable(v.versionId),/PHONE_SERVER_UNREACHABLE/);assert.deepEqual(phone.status(),{enabled:false});assert.throws(()=>phone.qr());await assert.rejects(fetch(origin+'/phone'));
    const pending=busy.enable(v.versionId);await assert.rejects(busy.enable(v.versionId),/PHONE_BUSY/);await assert.rejects(busy.disable(),/PHONE_BUSY/);
    await busy.shutdown();release();await assert.rejects(pending,/PHONE_SERVER_STOPPED/);assert.deepEqual(busy.status(),{enabled:false});
    await assert.rejects(busy.enable(v.versionId),/PHONE_SERVER_STOPPED/);
  }finally{release();await phone.close();await busy.close();store.close();}
});

test('Windows hotspot requires positive operational state, native Wi-Fi Direct evidence and one current private address',()=>{
  const name='Подключение по локальной сети* 10',guid='{2691AE87-3F2A-4E1D-BD75-6A7CD03A9DAB}';
  const interfaces={WiFi:entry('192.168.2.5'),[name]:entry('10.42.7.1'),vEthernet:entry('192.168.208.1'),VPN:entry('172.16.0.1')};
  const hotspot={name,guid,addresses:['10.42.7.1'],description:'Microsoft Wi-Fi Direct Virtual Adapter #2',hardware:false,status:'Up',interfaceType:71};
  const inventory={physical:['WiFi'],hotspotState:'On',hotspot:[hotspot]};
  const physical=[{name:'WiFi',address:'192.168.2.5'}];
  assert.deepEqual(windowsPhoneAddresses(inventory,interfaces),[{name,address:'10.42.7.1',kind:'hotspot'},...physical]);
  for(const hotspotState of ['Off','Unavailable'])assert.deepEqual(windowsPhoneAddresses({...inventory,hotspotState},interfaces),physical);
  for(const change of [{description:'Hyper-V Virtual Ethernet Adapter'},{description:'sing-tun Tunnel'},{hardware:true},{status:'Disconnected'},{interfaceType:6},{addresses:['192.168.137.1']},{addresses:['169.254.1.1']}]) {
    assert.deepEqual(windowsPhoneAddresses({...inventory,hotspot:[{...hotspot,...change}]},interfaces),physical);
  }
  assert.deepEqual(windowsPhoneAddresses({...inventory,hotspot:[hotspot,{...hotspot,name:'vEthernet',addresses:['192.168.208.1']}]},interfaces),physical);
  assert.throws(()=>windowsPhoneAddresses({...inventory,hotspot:[{...hotspot,guid:'not-a-guid'}]},interfaces),/PHONE_NETWORK_CHECK_FAILED/);
  assert.throws(()=>windowsPhoneAddresses({physical:'WiFi',hotspot:[]},interfaces),/PHONE_NETWORK_CHECK_FAILED/);
  // A familiar address and virtual name without positive OS evidence are insufficient.
  assert.deepEqual(windowsPhoneAddresses({...inventory,hotspotState:'Off'}, {[name]:entry('192.168.137.1')}),[]);
});

test('phone port configuration is fixed by default and rejects random/wildcard/invalid configuration',()=>{
  assert.equal(configuredPhonePort({}),52604);assert.equal(configuredPhonePort({YAPLIX_PHONE_PORT:'52605'}),52605);
  for(const value of ['0','','65536','-1','1.5','052604','52604x',' 52604','0.0.0.0'])assert.throws(()=>configuredPhonePort({YAPLIX_PHONE_PORT:value}),/PHONE_PORT_INVALID/);
});

test('fixed port survives refresh and manager restart; occupied port never silently falls back',async t=>{
  const host=lanAddresses()[0]?.address;if(!host){t.skip('No private IPv4');return;}
  const blocker=createServer();await new Promise<void>(r=>blocker.listen(0,host,r));
  const port=(blocker.address() as {port:number}).port;
  const store=new Store(':memory:'),v=store.save(spec,artifact);let now=Date.now();
  const addresses=async()=>[{name:'test physical',address:host}];
  const phone=new PhoneConnection(store,addresses,()=>now,undefined,port);
  let restarted:PhoneConnection|undefined;
  try{
    await assert.rejects(phone.enable(v.versionId),/PHONE_PORT_IN_USE/);
    assert.deepEqual(phone.status(),{enabled:false});assert.throws(()=>phone.qr(),/PHONE_ACCESS_EXPIRED/);
    await new Promise<void>(r=>blocker.close(()=>r()));
    const first=await phone.enable(v.versionId) as {url:string;expiresAt:number};
    const old=new URL(first.url);assert.equal(old.port,String(port));assert.equal(old.hostname,host);
    const access=await fetch(old.origin+'/phone/access',{method:'POST',body:old.hash.slice(1)});
    const cookie=access.headers.get('set-cookie')!.split(';')[0];assert.equal(access.status,200);
    assert.match(access.headers.get('set-cookie')!,/Path=\/phone; HttpOnly; SameSite=Strict; Max-Age=/);
    now+=1000;
    const next=await phone.enable(v.versionId) as {url:string;expiresAt:number};const fresh=new URL(next.url);
    assert.equal(fresh.origin,old.origin);assert.ok(fresh.hash!==old.hash);assert.equal(next.expiresAt,now+PHONE_TTL);
    assert.equal((await fetch(fresh.origin+'/phone/access',{method:'POST',body:old.hash.slice(1)})).status,401);
    assert.equal((await fetch(fresh.origin+'/phone/version',{headers:{Cookie:cookie}})).status,401);
    await phone.shutdown();
    restarted=new PhoneConnection(store,addresses,()=>now,undefined,port);
    const after=new URL((await restarted.enable(v.versionId) as {url:string}).url);
    assert.equal(after.origin,old.origin);assert.ok(after.hash!==fresh.hash);
    assert.equal((await fetch(after.origin+'/phone/access',{method:'POST',body:fresh.hash.slice(1)})).status,401);
    await restarted.disable();await assert.rejects(fetch(after.origin+'/phone'));
    assert.equal(store.getVersion(v.versionId).sha256,v.sha256);assert.equal(store.analytics(v.versionId).sessionCount,0);
  }finally{await phone.close();await restarted?.close();if(blocker.listening)await new Promise<void>(r=>blocker.close(()=>r()));store.close();}
});

test('one verified hotspot is preferred to the physical upstream; an explicit unavailable address is rejected',async t=>{
  const host=lanAddresses()[0]?.address;if(!host){t.skip('No private IPv4');return;}
  const store=new Store(':memory:'),v=store.save(spec,artifact);
  const phone=new PhoneConnection(store,async()=>[{name:'physical upstream',address:'192.168.255.254'},{name:'verified hotspot fixture',address:host,kind:'hotspot'}],undefined,undefined,0);
  try{
    const state=await phone.enable(v.versionId) as {url:string};assert.equal(new URL(state.url).hostname,host);
    await assert.rejects(phone.enable(v.versionId,'10.222.222.222'),/HOST_NOT_AVAILABLE/);
  }finally{await phone.close();store.close();}
});
test('full LAN/HTTPS owner sessions cannot manage local phone sharing',async()=>{
  const store=new Store(':memory:'),phone=new PhoneConnection(store,async()=>[]),key='s'.repeat(43);
  try{for(const mode of ['lan','https']){
    const policy=networkPolicy(mode==='lan'?{YAPLIX_MODE:mode,YAPLIX_HOST:'192.168.1.2',YAPLIX_ACCESS_KEY:key}:{YAPLIX_MODE:mode,PUBLIC_URL:'https://owner.invalid',YAPLIX_ACCESS_KEY:key});
    const app=createApp(store,undefined,undefined,policy,undefined,undefined,undefined,phone),base=policy.origin!;const proxy:Record<string,string>=mode==='https'?{'X-Forwarded-Proto':'https'}:{};
    const login=await app.request(base+'/api/access',{method:'POST',headers:{...proxy,'Content-Type':'application/json'},body:JSON.stringify({key})});
    const cookie=login.headers.get('set-cookie')!;
    for(const [path,method] of [['/api/phone','GET'],['/api/phone','POST'],['/api/phone','DELETE'],['/api/phone/qr.svg','GET']])assert.equal((await app.request(base+path,{method,headers:{...proxy,Cookie:cookie,'Content-Type':'application/json'},...(method==='GET'?{}:{body:'{}'})})).status,403);
  }}finally{await phone.close();store.close();}
});
