import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { runTunnel, redact, explain, TunnelFailure, publicHealth } from '../scripts/tunnel-runtime.ts';
import type { TunnelOptions } from '../scripts/tunnel-runtime.ts';
import { RuntimeControl, runtimeKey } from '../src/runtime-control.ts';
import { createApp } from '../src/api.ts';
import { Store } from '../src/store.ts';
import { TelegramSessions } from '../src/telegram.ts';
import { telegramMenu } from '../scripts/telegram-menu.ts';
import { productionServer } from './production-helper.ts';
import { signedData } from './telegram-fixture.ts';
import { spec } from './helpers.ts';

const token = '123456:synthetic-test-token';
const env = { ...process.env, TELEGRAM_BOT_TOKEN: token, TELEGRAM_ALLOWED_USER_IDS: '123456789', LIVE_PROVIDER: 'none', PUBLIC_URL: '', YAPLIX_ACCESS_KEY: '' };
async function unusedPort() {
  const server = createServer(); await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as {port:number}).port; await new Promise<void>(done => server.close(() => done())); return port;
}
function fixture(scenario = 'url') { return spawn(process.execPath, ['tests/fixtures/tunnel-process.mjs', scenario], { stdio: ['ignore','pipe','pipe'], windowsHide: true }); }
async function scenario(extra: Partial<TunnelOptions> = {}) {
  const directory = mkdtempSync('.local/tunnel-test-'), controller = new AbortController(), messages: string[] = [], children: ReturnType<typeof fixture>[] = [];
  const options: TunnelOptions = { port: await unusedPort(), binary: 'unused', connectorEnv: {}, env: { ...env, YAPLIX_DB: directory + '/data.sqlite' }, signal: controller.signal, startupMs: 3000, publicMs: 300,
    connector: () => { const child = fixture(); children.push(child); return child; },
    publicProbe: async (_origin, instance) => { assert.match(instance, /^[a-f0-9]{32}$/); },
    announce: message => { messages.push(message); if (message.startsWith('Публичный HTTP')) controller.abort(); }, ...extra };
  try { await runTunnel(options); return { messages, port: options.port, children }; }
  finally { for (const child of children) assert.notEqual(child.exitCode ?? child.signalCode, null); rmSync(directory, { recursive: true }); }
}
test('A/J/K: free port starts ready backend, then closes owned processes; repeated runs leave port free', async () => {
  for (let i = 0; i < 2; i++) {
    const result = await scenario(); assert.ok(result.messages.some(m => m.includes('Backend запущен')));
    await assert.rejects(fetch('http://127.0.0.1:' + result.port + '/healthz'));
  }
});
test('B/I: existing same-clone YAPLIX is reused and survives cancellation with local mode restored', async () => {
  const server = await productionServer('127.0.0.1', env);
  try {
    const result = await scenario({ port: server.port }); assert.ok(result.messages.some(m => m.includes('существующий backend')));
    assert.equal((await fetch(server.url + '/api/health')).status, 200);
    assert.equal((await fetch(server.url + '/healthz', { headers: { 'X-Forwarded-Proto': 'https' } })).status, 403);
  } finally { await server.stop(); server.cleanup(); }
});
test('C: foreign HTTP 200 service is preserved and never receives the control key', async () => {
  let posted = false; const server = createServer((req,res) => { posted ||= req.method === 'POST'; res.setHeader('Content-Type', 'application/json'); res.end('{"app":"YAPLIX","protocol":1,"instance":"spoof","ready":true}'); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const port = (server.address() as {port:number}).port;
  try { await assert.rejects(scenario({ port }), /PORT_IN_USE/); assert.equal((await fetch('http://127.0.0.1:' + port)).status,200); assert.equal(posted,false); }
  finally { await new Promise<void>(done => server.close(() => done())); }
});
test('D/E/F: spawn failure, exit code/stderr, fragmented secrets and URL timeout are bounded and explained', async () => {
  await assert.rejects(scenario({ connector: () => spawn('yaplix-missing-binary-fixture', [], { stdio: ['ignore','pipe','pipe'] }) }), /SPAWN_ERROR/);
  await assert.rejects(scenario({ connector: () => fixture('exit') }), (e: unknown) => {
    assert.ok(e instanceof TunnelFailure); const message = explain(e, { TEST_SECRET_KEY: 'synthetic-secret-value' });
    assert.match(message, /DNS_FAILURE/); assert.match(message, /17/); assert.doesNotMatch(message, /synthetic-secret-value/); return true;
  });
  await assert.rejects(scenario({ connector: () => fixture('split-secret') }), (e: unknown) => { assert.doesNotMatch(explain(e, { TEST_SECRET_KEY: 'synthetic-secret-value' }), /synthetic-secret-value/); return true; });
  await assert.rejects(scenario({ startupMs: 600, connector: () => fixture('silent') }), /PUBLIC_URL_TIMEOUT/);
  assert.doesNotMatch(readFileSync('.local/logs/tunnel.log','utf8'), /Bearer synthetic-secret-value|token=synthetic-secret-value/);
});
test('G: announced URL without successful external probe cannot configure Telegram or report connected', async () => {
  let menuCalls = 0;
  await assert.rejects(scenario({ menu: true, menuUpdate: async () => { menuCalls++; }, publicProbe: async () => { throw new Error('synthetic TLS/DNS failure'); } }), /PUBLIC_HEALTH_FAILED/);
  assert.equal(menuCalls,0);
  await assert.rejects(scenario({ connector:()=>fixture('url-exit'),menu:true,menuUpdate:async()=>{menuCalls++;},publicProbe:async()=>{await new Promise(done=>setTimeout(done,100));} }),/TUNNEL_CLOSED/);assert.equal(menuCalls,0);
  await assert.rejects(publicHealth('http://127.0.0.1:1','x',new AbortController().signal), /PUBLIC_URL_INVALID/);
});
test('lost existing backend heartbeat terminates the supervisor and its connector',async()=>{
  const server=await productionServer('127.0.0.1',env),controller=new AbortController();let stopping:Promise<void>|undefined;
  const deadline=setTimeout(()=>controller.abort(),12_000);
  try {
    await assert.rejects(scenario({port:server.port,signal:controller.signal,announce:message=>{if(message.startsWith('Публичный HTTP'))stopping=server.stop();}}),/BACKEND_NOT_READY/);
  }finally{clearTimeout(deadline);await stopping;await server.stop();server.cleanup();}
});
test('H: Telegram menu failure is explicit and leaves verified tunnel/backend running until user cancellation', async () => {
  const server = await productionServer('127.0.0.1',env); let checked = false;
  try {
    const result = await scenario({ port:server.port, menu:true, menuUpdate:async () => { throw Error('synthetic menu failure'); }, menuClear:async () => {
      // Node fetch does not support overriding Host; emulate the proxy with real HTTP.
      const status=await new Promise<number|undefined>((done,fail)=>{const req=httpRequest(server.url+'/healthz',{headers:{Host:'synthetic-tunnel.trycloudflare.com','X-Forwarded-Proto':'https'}},res=>{res.resume();done(res.statusCode);});req.on('error',fail);req.end();});
      assert.equal(status,200);checked=true;
    } });
    assert.ok(result.messages.some(m=>m.includes('TELEGRAM_MENU_FAILED'))); assert.equal(checked,true); assert.equal((await fetch(server.url+'/api/health')).status,200);
  } finally { await server.stop();server.cleanup(); }
});
test('L: public health is minimal, auth guards generation/history/secrets and control; owner restriction fails closed', async () => {
  const store = new Store(':memory:'), policy = { mode:'local' as 'local'|'https',host:'127.0.0.1',port:3000 }, key = randomBytes(32).toString('hex');
  const telegram = new TelegramSessions(env),control = new RuntimeControl(policy,key,()=>telegram.singleOwner()); let calls=0;
  const app = createApp(store,{generate:async()=>{calls++;throw Error('must not call');}},undefined,policy,telegram,control);
  const local = 'http://127.0.0.1:3000',origin = 'https://synthetic-tunnel.trycloudflare.com';
  const post = (base:string,path:string,body:object,headers:Record<string,string>={})=>app.request(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  try {
    const lease = control.update({action:'prepare',key:'x'.repeat(40)}).lease;
    control.update({action:'activate',lease,origin});
    const headers = {'X-Forwarded-Proto':'https'};
    const health = await app.request(origin+'/healthz',{headers});assert.equal(health.status,200);
    assert.deepEqual(Object.keys(await health.json()).sort(),['app','instance','protocol','ready']);
    for (const path of ['/api/games','/api/diagnostics','/api/versions/'+randomBytes(16).toString('hex'),'/api/backups','/.env','/.local/data/yaplix.sqlite','/.local/logs/tunnel.log','/api/runtime/tunnel']) assert.ok([401,403].includes((await app.request(origin+path,{headers})).status),path);
    assert.equal((await post(origin,'/api/games',{mode:'live',spec},headers)).status,401);assert.equal(calls,0);
    assert.equal((await post(origin,'/api/telegram/auth',{initData:signedData(token,999)},headers)).status,403);
    assert.equal((await post(local,'/api/runtime/tunnel',{action:'release',lease})).status,403);
    control.update({action:'release',lease});assert.equal((await app.request(local+'/api/health')).status,200);
    const multiple = new TelegramSessions({...env,TELEGRAM_ALLOWED_USER_IDS:'123456789,999'});
    assert.throws(()=>createApp(store,undefined,undefined,{mode:'https',host:'127.0.0.1',port:3000,origin,key:'x'.repeat(40)},multiple),/TELEGRAM_SINGLE_OWNER_REQUIRED/);
    assert.throws(()=>new TelegramSessions({...env,TELEGRAM_ALLOWED_USER_IDS:'0'}),/INVALID_TELEGRAM_CONFIGURATION/);
  } finally {store.close();}
});
test('Telegram readback, new URL update, conditional reset and token filtering', async () => {
  let menu:any={type:'commands'};const urls:string[]=[];
  const api = telegramMenu({...env,TELEGRAM_BOT_USERNAME:'YaplixBot'},async (input,init)=>{
    const method=String(input).split('/').pop();let result;
    if(method==='getMe')result={is_bot:true,username:'YaplixBot'};
    else if(method==='setChatMenuButton'){menu=JSON.parse(String(init?.body)).menu_button;urls.push(menu.web_app?.url??'cleared');result=true;}
    else result=menu;
    return Response.json({ok:true,result});
  });
  await api.update('https://first.trycloudflare.com');await api.update('https://second.trycloudflare.com');
  await api.clear('https://first.trycloudflare.com');assert.equal(menu.web_app.url,'https://second.trycloudflare.com/telegram');
  await api.clear('https://second.trycloudflare.com');assert.equal(menu.type,'commands');assert.equal(urls.length,3);
  const value = redact(token+' sk-synthetic-secret Authorization=Bearer-secret initData=private https://user:password@proxy.test',env);
  assert.doesNotMatch(value,/synthetic|private|password|Bearer-secret/);
  assert.doesNotMatch(redact('Authorization: Bearer short-secret\n'),/short-secret/);
  for(const input of [JSON.stringify({initData:'query_id=private&hash=short',token:'short-private-token',password:'proxy-private-password'}),JSON.stringify({detail:JSON.stringify({token:'short-private-token'})})]) assert.doesNotMatch(redact(input,{}),/private/);
  assert.match(runtimeKey(),/^[a-f0-9]{64}$/);assert.equal(existsSync('.local/tunnel-url.txt'),false);
});
test('lease expiry fails closed for public health, authorized API and shares, while local release remains possible', async () => {
  const store=new Store(':memory:'),policy={mode:'local' as 'local'|'https',host:'127.0.0.1',port:3000},control=new RuntimeControl(policy,'x'.repeat(64),()=>true),app=createApp(store,undefined,undefined,policy, new TelegramSessions(env),control);
  const now=Date.now,origin='https://expiry.trycloudflare.com';
  try {
    const lease=control.update({action:'prepare',key:'x'.repeat(40)}).lease;control.update({action:'activate',lease,origin});
    const started=now();Date.now=()=>started+21_000;
    for(const path of ['/healthz','/api/games','/play/unknown/999/signature']) {const response=await app.request(origin+path,{headers:{'X-Forwarded-Proto':'https'}});assert.equal(response.status,503);assert.equal((await response.json()).error,'TUNNEL_LEASE_EXPIRED');}
    const response=await app.request('http://127.0.0.1:3000/api/runtime/tunnel',{method:'POST',headers:{'Content-Type':'application/json','X-Yaplix-Control':'x'.repeat(64)},body:JSON.stringify({action:'release',lease})});assert.equal(response.status,200);
    assert.equal((await app.request('http://127.0.0.1:3000/api/health')).status,200);
  }finally{Date.now=now;store.close();}
});
