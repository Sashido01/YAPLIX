import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { networkPolicy, AccessSessions } from '../src/access.ts';
import { runtimeKey } from '../src/runtime-control.ts';
import { createApp } from '../src/api.ts';
import { Store, PROJECT_ROOT } from '../src/store.ts';
import { spec, event, artifact } from './helpers.ts';

test('network configuration stays loopback unless private LAN or HTTPS proxy is explicitly secured', () => {
  assert.equal(networkPolicy({}).host, '127.0.0.1');
  for (const env of [{YAPLIX_HOST:'0.0.0.0'},{YAPLIX_MODE:'lan',YAPLIX_HOST:'192.168.0.2'},{YAPLIX_MODE:'https',PUBLIC_URL:'http://demo.example'}]) assert.throws(()=>networkPolicy(env));
  const key=randomBytes(32).toString('base64url');
  assert.equal(networkPolicy({YAPLIX_MODE:'lan',YAPLIX_HOST:'192.168.0.2',PORT:'3204',YAPLIX_ACCESS_KEY:key}).origin,'http://192.168.0.2:3204');
  for (const host of ['8.8.8.8','0.0.0.0','192.168.999.2','192.168.01.2']) assert.throws(()=>networkPolicy({YAPLIX_MODE:'lan',YAPLIX_HOST:host,YAPLIX_ACCESS_KEY:key}));
  assert.throws(()=>networkPolicy({YAPLIX_MODE:'https',YAPLIX_HOST:'0.0.0.0',PUBLIC_URL:'https://demo.example',YAPLIX_ACCESS_KEY:key}));
});

test('LAN authentication guards data/export/backup and retains exact Host, Origin and session tokens', async () => {
  const key=randomBytes(32).toString('base64url'),policy=networkPolicy({YAPLIX_MODE:'lan',YAPLIX_HOST:'192.168.0.2',PORT:'3204',YAPLIX_ACCESS_KEY:key});
  const store=new Store(':memory:'),app=createApp(store,undefined,undefined,policy),base=policy.origin!;
  try {
    assert.match(await(await app.request(base)).text(),/Ключ доступа/);
    for(const path of ['/api/games','/api/diagnostics','/api/health','/api/backups','/api/versions/00000000-0000-4000-8000-000000000000/export']) assert.equal((await app.request(base+path)).status,401);
    const login=(value:string,origin=base)=>app.request(base+'/api/access',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({key:value})});
    assert.equal((await login(key,'null')).status,403);assert.equal((await login('wrong')).status,401);
    const logged=await login(key),cookie=logged.headers.get('set-cookie')!;assert.equal(logged.status,200);assert.match(cookie,/HttpOnly; SameSite=Strict/);assert.doesNotMatch(cookie,/Secure/);
    assert.equal((await app.request(base+'/api/games',{headers:{Cookie:cookie.split(';')[0]}})).status,200);
    assert.equal((await app.request(base+'/api/games',{headers:{Cookie:cookie.split(';')[0],Origin:'http://attacker.example'}})).status,403);
    assert.equal((await app.request('http://attacker.example/api/games',{headers:{Cookie:cookie}})).status,403);
    const version=store.save(spec,artifact);
    assert.equal(store.getVersion(version.versionId).model,null);
    const session=await(await app.request(base+'/api/versions/'+version.versionId+'/sessions',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'})).json();
    assert.equal((await app.request(base+'/api/sessions/'+session.sessionId+'/events',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(event(session,'game_ready',0))})).status,401);
    const newProcess=createApp(store,undefined,undefined,policy);assert.equal((await newProcess.request(base+'/api/games',{headers:{Cookie:cookie}})).status,401);
  } finally { store.close(); }
});

test('HTTPS proxy requires correct public origin/forwarded scheme and secure cookie; login failures are bounded', async () => {
  const key=randomBytes(32).toString('base64url'),policy=networkPolicy({YAPLIX_MODE:'https',PUBLIC_URL:'https://demo.example',YAPLIX_ACCESS_KEY:key}),store=new Store(':memory:'),app=createApp(store,undefined,undefined,policy);
  try {
    assert.equal((await app.request('http://demo.example/')).status,403);
    const logged=await app.request('http://demo.example/api/access',{method:'POST',headers:{'X-Forwarded-Proto':'https',Origin:'https://demo.example','Content-Type':'application/json'},body:JSON.stringify({key})});
    assert.equal(logged.status,200);assert.match(logged.headers.get('set-cookie')!,/; Secure/);assert.match(logged.headers.get('strict-transport-security')!,/max-age/);
    const sessions=new AccessSessions(key,true);for(let i=0;i<10;i++)assert.throws(()=>sessions.login('bad'),/ACCESS_DENIED/);assert.throws(()=>sessions.login('bad'),/ACCESS_RATE_LIMIT/);assert.match(sessions.login(key),/yaplix_access=/);
  } finally { store.close(); }
});

test('production static gzip/ETag are real and API/game exports retain no-store and exact bytes', async () => {
  const store=new Store(':memory:'),app=createApp(store);
  try {
    const plain=await app.request('/runtime/ui.js'),raw=Buffer.from(await plain.arrayBuffer());assert.equal(plain.status,200);
    const compressed=await app.request('/runtime/ui.js',{headers:{'Accept-Encoding':'gzip'}});assert.equal(compressed.headers.get('content-encoding'),'gzip');assert.ok(gunzipSync(Buffer.from(await compressed.arrayBuffer())).equals(raw));
    const revalidated=await app.request('/runtime/ui.js',{headers:{'If-None-Match':plain.headers.get('etag')!}});assert.equal(revalidated.status,304);
    assert.equal((await app.request('/api/games')).headers.get('cache-control'),'no-store');
  } finally {store.close();}
});

test('production graceful shutdown via local IPC closes SQLite and survives update/restart', {timeout:15_000}, async () => {
  const dir=mkdtempSync('.local/network-restart-'),listener=createServer();await new Promise<void>(done=>listener.listen(0,'127.0.0.1',done));const port=(listener.address() as any).port;await new Promise<void>(done=>listener.close(()=>done()));
  let child:ReturnType<typeof fork>|undefined,closed:Promise<number|null>,output='';
  const start=async()=>{child=fork('src/server.ts',[],{cwd:PROJECT_ROOT,env:{...process.env,PORT:String(port),YAPLIX_MODE:'local',YAPLIX_HOST:'127.0.0.1',PUBLIC_URL:'',LIVE_PROVIDER:'none',YAPLIX_DB:dir+'/data.sqlite'},silent:true});closed=new Promise(done=>child!.once('exit',done));await new Promise<void>((done,fail)=>{child!.stdout!.once('data',()=>done());child!.once('error',fail);child!.once('exit',()=>fail(Error('START_FAILED')));});child.stdout!.on('data',data=>output+=data);};
  const stop=async()=>{child!.send('shutdown');assert.equal(await closed,0);child=undefined;assert.match(output,/SQLite closed/);};
  try {await start();const url='http://127.0.0.1:'+port;const setup=new Store(dir+'/data.sqlite');const v=setup.save(spec,artifact);setup.close();await stop();await start();assert.equal((await(await fetch(url+'/api/versions/'+v.versionId)).json()).sha256,v.sha256);await stop();}
  finally {child?.kill();rmSync(dir,{recursive:true});}
});

test('authenticated loopback shutdown endpoint closes SQLite, releases port and rejects unauthenticated and forwarded callers', {timeout:20_000}, async () => {
  const dir=mkdtempSync('.local/network-shutdown-'),listener=createServer();await new Promise<void>(done=>listener.listen(0,'127.0.0.1',done));const port=(listener.address() as any).port;await new Promise<void>(done=>listener.close(()=>done()));
  let child:ReturnType<typeof fork>|undefined,closed!:Promise<number|null>,output='';
  const start=async()=>{child=fork('src/server.ts',[],{cwd:PROJECT_ROOT,env:{...process.env,PORT:String(port),YAPLIX_MODE:'local',YAPLIX_HOST:'127.0.0.1',PUBLIC_URL:'',LIVE_PROVIDER:'none',YAPLIX_DB:dir+'/data.sqlite'},silent:true});closed=new Promise(done=>child!.once('exit',done));await new Promise<void>((done,fail)=>{child!.stdout!.once('data',()=>done());child!.once('error',fail);child!.once('exit',()=>fail(Error('START_FAILED')));});child.stdout!.on('data',data=>output+=data);};
  const begin=Date.now();
  try{
    await start();const url='http://127.0.0.1:'+port;
    // Version saved before shutdown must survive a full restart afterwards.
    const setup=new Store(dir+'/data.sqlite');const v=setup.save(spec,artifact);setup.close();
    const noHeader=await fetch(url+'/api/runtime/shutdown',{method:'POST'});assert.equal(noHeader.status,403);
    const wrongKey=await fetch(url+'/api/runtime/shutdown',{method:'POST',headers:{'X-Yaplix-Control':'a'.repeat(64)}});assert.equal(wrongKey.status,403);
    assert.equal((await fetch(url+'/api/runtime/shutdown',{method:'POST',headers:{'X-Yaplix-Control':'x'.repeat(64),'X-Forwarded-Proto':'https'}})).status,403);
    const response=await fetch(url+'/api/runtime/shutdown',{method:'POST',headers:{'X-Yaplix-Control':runtimeKey()}});assert.equal(response.status,202);
    assert.equal(await closed,0);child=undefined;
    assert.match(output,/SQLite closed/);assert.ok(Date.now()-begin<15000);
    await start();
    assert.equal((await(await fetch(url+'/api/versions/'+v.versionId)).json()).sha256,v.sha256);
    child!.send('shutdown');assert.equal(await closed,0);child=undefined;
  }finally{child?.kill();await new Promise<void>(done=>{let attempt=0;const wipe=()=>{try{rmSync(dir,{recursive:true});done();}catch(e){if(++attempt>5)return done();setTimeout(wipe,300);}};wipe();});}
});
