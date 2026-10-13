import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { networkPolicy, AccessSessions } from '../src/access.ts';
import { createApp } from '../src/api.ts';
import { Store, PROJECT_ROOT } from '../src/store.ts';
import { spec, event } from './helpers.ts';

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
    const version=await(await app.request(base+'/api/games',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json',Origin:base},body:JSON.stringify({mode:'demo',spec})})).json();
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
  try {await start();const url='http://127.0.0.1:'+port;const v=await(await fetch(url+'/api/games',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'demo',spec})})).json();await stop();await start();assert.equal((await(await fetch(url+'/api/versions/'+v.versionId)).json()).sha256,v.sha256);await stop();}
  finally {child?.kill();rmSync(dir,{recursive:true});}
});


test('production HTTP client disconnect cancels upstream generation without saving a version', {timeout:15_000}, async()=>{
  const dir=mkdtempSync('.local/network-cancel-');let started!:()=>void,disconnected!:()=>void;
  const began=new Promise<void>(done=>started=done),ended=new Promise<void>(done=>disconnected=done);
  const upstream=createServer((req,res)=>{
    res.on('close',disconnected);res.writeHead(200);res.write('{');started();
  });
  await new Promise<void>(done=>upstream.listen(0,'127.0.0.1',done));
  const listener=createServer();await new Promise<void>(done=>listener.listen(0,'127.0.0.1',done));const port=(listener.address() as any).port;await new Promise<void>(done=>listener.close(()=>done()));
  const child=fork('src/server.ts',[],{cwd:PROJECT_ROOT,silent:true,env:{...process.env,PORT:String(port),YAPLIX_MODE:'local',YAPLIX_HOST:'127.0.0.1',PUBLIC_URL:'',YAPLIX_DB:dir+'/data.sqlite',LIVE_PROVIDER:'cloud',CLOUD_MODEL:'synthetic-model',CLOUD_API_KEY:'synthetic-not-a-secret',CLOUD_BASE_URL:'http://127.0.0.1:'+(upstream.address() as any).port}});
  const closed=new Promise<number|null>(done=>child.once('exit',done));
  try{
    await new Promise<void>((done,fail)=>{child.stdout!.once('data',()=>done());child.once('error',fail);child.once('exit',()=>fail(Error('START_FAILED')));});
    const controller=new AbortController(),base='http://127.0.0.1:'+port;
    const pending=fetch(base+'/api/games',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({spec,mode:'live'}),signal:controller.signal});
    const rejected=assert.rejects(pending,/abort/i);await began;controller.abort();await rejected;
    await Promise.race([ended,new Promise<void>((_,reject)=>{const timer=setTimeout(()=>reject(Error('UPSTREAM_NOT_CANCELLED')),1500);timer.unref();})]);
    assert.deepEqual((await(await fetch(base+'/api/games')).json()).games,[]);
    child.send('shutdown');assert.equal(await closed,0);
  }finally{child.kill();upstream.closeAllConnections();await new Promise<void>(done=>upstream.close(()=>done()));rmSync(dir,{recursive:true});}
});
