import { test, after } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as secureServer } from 'node:https';
import { connect } from 'node:net';
import type { Socket } from 'node:net';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { CloudTransport, ProviderFailure } from '../src/transport.ts';
import { networkRoute, networkRequest, networkCategory, bypassProxy } from '../src/llm-network.ts';
import { testCertificate } from './tls-fixture.ts';
import { GenerationEngine } from '../src/live.ts';
import { GenerationJobs } from '../src/jobs.ts';
import { Store } from '../src/store.ts';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { spec, html } from './helpers.ts';

const tls = testCertificate(), trust = getCACertificates('default');
setDefaultCACertificates([...trust, tls.cert]);
after(() => setDefaultCACertificates(trust));
async function listen(t: TestContext, server: ReturnType<typeof createServer>) {
  const sockets = new Set<Socket>(); server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { for (const s of sockets) s.destroy(); await new Promise<void>(r => server.close(() => r())); });
  return (server.address() as { port: number }).port;
}

test('Auto priority, lowercase, NO_PROXY, required proxy and unsupported settings fail closed', () => {
  const u = new URL('https://ollama.com/v1/models');
  assert.deepEqual(networkRoute(u, {}), { route: 'direct' });
  assert.equal(networkRoute(u, { HTTPS_PROXY: 'https://proxy.test', https_proxy: 'http://lower.test' }).proxy, 'http://lower.test/');
  assert.equal(networkRoute(u, { HTTP_PROXY: 'http://proxy.test' }).route, 'http-proxy');
  assert.equal(networkRoute(u, { HTTPS_PROXY: 'http://proxy.test', NO_PROXY: 'ollama.com' }).route, 'direct');
  assert.equal(networkRoute(u, { YAPLIX_LLM_NETWORK: 'proxy', YAPLIX_LLM_PROXY: 'https://required.test', NO_PROXY: '*' }).route, 'https-proxy');
  assert.equal(networkRoute(u, { YAPLIX_LLM_NETWORK: 'direct', HTTPS_PROXY: 'http://unused.test' }).route, 'direct');
  for (const env of [{ YAPLIX_LLM_NETWORK: 'proxy' }, { YAPLIX_LLM_PROXY: 'invalid' }, { ALL_PROXY: 'socks5://proxy.test' }, { HTTPS_PROXY: 'socks5h://proxy.test' }]) assert.throws(() => networkRoute(u, env), /LLM_(NETWORK_CONFIGURATION|PROXY_UNSUPPORTED)/);
  for (const value of ['.ollama.com', '*.ollama.com:443', 'ollama.com', '*']) assert.equal(bypassProxy(u, value), true);
  for (const value of ['otherollama.com', 'ollama.com:80', '10.0.0.0/8']) assert.equal(bypassProxy(u, value), false);
});

test('direct HTTPS uses OS routing and validates TLS (transparent route simulation)', async t => {
  const port = await listen(t, secureServer(tls, (_q, r) => r.end('ok')));
  const result = await networkRequest(new URL('https://127.0.0.1:' + port), { signal: AbortSignal.timeout(2000) }, 'synthetic', async r => r.text(), {});
  assert.equal(result, 'ok');
});

for (const secure of [false, true]) test((secure ? 'HTTPS' : 'HTTP') + ' authenticated CONNECT: both providers use same route for models and SSE inference', async t => {
  const requests: string[] = [], proxyAuth: string[] = [], targetAuth: string[] = [];
  const target = secureServer(tls, (q, r) => {
    requests.push(q.url!); targetAuth.push(q.headers['proxy-authorization'] ?? '');
    if (q.url!.endsWith('/models')) { r.end(JSON.stringify({ data: [{ id: 'gemma4:31b' }, { id: 'openrouter/free' }] })); return; }
    let body = ''; q.on('data', b => body += b); q.on('end', () => {
      const model = JSON.parse(body).model;
      r.writeHead(200, { 'Content-Type': 'text/event-stream' });
      r.write('data: ' + JSON.stringify({ model, choices: [{ delta: { content: 'fixture' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
      // Deliberately keep the body open: DONE must terminate through a proxy.
    });
  });
  const targetPort = await listen(t, target);
  const proxy = secure ? secureServer(tls) : createServer();
  proxy.on('connect', (q, socket, head) => {
    proxyAuth.push(q.headers['proxy-authorization'] ?? '');
    assert.match(q.url!, /^(ollama.com|openrouter.ai):443$/);
    const upstream = connect(targetPort, '127.0.0.1', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); socket.pipe(upstream); upstream.pipe(socket); });
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy()); socket.on('close', () => upstream.destroy());
  });
  const proxyPort = await listen(t, proxy);
  const env = { YAPLIX_LLM_NETWORK: 'proxy', YAPLIX_LLM_PROXY: (secure ? 'https' : 'http') + '://user:synthetic-pass@127.0.0.1:' + proxyPort };
  for (const [base, model] of [['https://ollama.com/v1', 'gemma4:31b'], ['https://openrouter.ai/api/v1', 'openrouter/free']]) {
    const cloud = new CloudTransport({ base, key: 'synthetic-key', model, networkEnv: () => env });
    const ready = await cloud.diagnose(AbortSignal.timeout(2000));
    assert.equal(ready.state, 'ready'); assert.equal(ready.network.route, secure ? 'https-proxy' : 'http-proxy'); assert.equal(ready.inferenceVerified, false);
    assert.equal((await cloud.complete([], AbortSignal.timeout(2000), { stage() {}, dispatch() {}, partial() {}, attempt() {} })).code, 'fixture');
  }
  assert.equal(requests.length, 6); assert.equal(proxyAuth.length, 6);
  assert.ok(proxyAuth.every(x => x === 'Basic ' + Buffer.from('user:synthetic-pass').toString('base64'))); assert.ok(targetAuth.every(x => x === ''));
});

test('407, invalid proxy, DNS, timeout and TLS have sanitized distinct diagnostics', async t => {
  const proxy = createServer(); proxy.on('connect', (_q, s) => s.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n'));
  const port = await listen(t, proxy);
  const cloud = new CloudTransport({ base: 'https://ollama.com/v1', key: 'secret-api', model: 'gemma4:31b', networkEnv: () => ({ HTTPS_PROXY: 'http://user:secret-proxy@127.0.0.1:' + port }) });
  const result = await cloud.diagnose(AbortSignal.timeout(1500));
  assert.equal(result.network.category, 'LLM_PROXY_AUTH'); assert.ok(!JSON.stringify(result).includes('secret'));
  assert.equal(result.network.httpStatus, 407);
  for (const [code, route, expected] of [['ENOTFOUND', 'direct', 'LLM_DNS'], ['ECONNREFUSED', 'direct', 'LLM_TCP_CONNECTION'], ['ECONNREFUSED', 'http-proxy', 'LLM_PROXY_CONNECTION'], ['CERT_HAS_EXPIRED', 'https-proxy', 'LLM_TLS'], ['ETIMEDOUT', 'direct', 'LLM_RESPONSE_TIMEOUT']] as const) assert.equal(networkCategory({ cause: { code } }, route), expected);
  const bad = new CloudTransport({ base: 'http://127.0.0.1:1', key: 'synthetic', model: 'fixture', networkEnv: () => ({ HTTPS_PROXY: 'http://unused', HTTP_PROXY: 'http://127.0.0.1:1' }) });
  assert.equal((await bad.diagnose(AbortSignal.timeout(1000))).network.category, 'LLM_PROXY_CONNECTION');
});

test('Basic proxy authentication preserves an empty password without forwarding credentials to origin', async t => {
  let authorization = '';
  const targetPort = await listen(t, createServer((q, r) => { assert.equal(q.headers['proxy-authorization'], undefined); r.end('{"data":[{"id":"fixture"}]}'); }));
  const proxy = createServer(); proxy.on('connect', (q, socket) => {
    authorization = q.headers['proxy-authorization'] ?? '';
    const upstream = connect(targetPort, '127.0.0.1', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); socket.pipe(upstream); upstream.pipe(socket); });
    upstream.on('error', () => socket.destroy()); socket.on('close', () => upstream.destroy());
  });
  const port = await listen(t, proxy);
  const result = await new CloudTransport({ base: 'http://127.0.0.1:' + targetPort, key: 'synthetic', model: 'fixture', networkEnv: () => ({ YAPLIX_LLM_NETWORK: 'proxy', YAPLIX_LLM_PROXY: 'http://user:@127.0.0.1:' + port }) }).diagnose(AbortSignal.timeout(1000));
  assert.equal(result.state, 'ready'); assert.equal(authorization, 'Basic ' + Buffer.from('user:').toString('base64'));
});

test('simulated DNS failure, local response timeout and untrusted TLS are finite', async t => {
  t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('private DNS host',{cause:Object.assign(new Error('private'),{code:'ENOTFOUND'})});});
  const missing = new CloudTransport({ base: 'https://yaplix-test.invalid/v1', key: 'synthetic', model: 'fixture', networkEnv: () => ({}) });
  assert.equal((await missing.diagnose(AbortSignal.timeout(2000))).network.category, 'LLM_DNS');t.mock.restoreAll();
  const port = await listen(t, createServer(() => {}));
  const held = new CloudTransport({ base: 'http://127.0.0.1:' + port, key: 'synthetic', model: 'fixture', networkEnv: () => ({}) });
  assert.equal((await held.diagnose(AbortSignal.timeout(100))).network.category, 'LLM_RESPONSE_TIMEOUT');
  const untrusted = testCertificate(), securePort = await listen(t, secureServer(untrusted, (_q, r) => r.end('{}')));
  const invalid = new CloudTransport({ base: 'https://127.0.0.1:' + securePort, key: 'synthetic', model: 'fixture', networkEnv: () => ({}) });
  assert.equal((await invalid.diagnose(AbortSignal.timeout(1000))).network.category, 'LLM_TLS');
});

test('next request sees changed network configuration; required broken proxy never falls back direct', async t => {
  let calls = 0;
  const port = await listen(t, createServer((_q, r) => { calls++; r.end('{"data":[{"id":"fixture"}]}'); }));
  const env: NodeJS.ProcessEnv = {};
  const cloud = new CloudTransport({ base: 'http://127.0.0.1:' + port, key: 'synthetic', model: 'fixture', networkEnv: () => env });
  assert.equal((await cloud.diagnose(AbortSignal.timeout(1000))).state, 'ready');
  env.YAPLIX_LLM_NETWORK = 'proxy'; env.YAPLIX_LLM_PROXY = 'http://127.0.0.1:1';
  assert.equal((await cloud.diagnose(AbortSignal.timeout(1000))).network.category, 'LLM_PROXY_CONNECTION'); assert.equal(calls, 1);
  env.YAPLIX_LLM_NETWORK = 'direct'; assert.equal((await cloud.diagnose(AbortSignal.timeout(1000))).state, 'ready'); assert.equal(calls, 2);
});

for (const [status, category] of [[401, 'LLM_AUTH'], [429, 'LLM_RATE_LIMIT'], [503, 'LLM_HTTP']] as const) test('service diagnostic HTTP ' + status + ' never claims inference', async t => {
  const port = await listen(t, createServer((_q, r) => { r.writeHead(status); r.end('private upstream detail'); }));
  const result = await new CloudTransport({ base: 'http://127.0.0.1:' + port, key: 'synthetic', model: 'fixture', networkEnv: () => ({}) }).diagnose(AbortSignal.timeout(1000));
  assert.equal(result.network.category, category); assert.equal(result.network.httpStatus, status); assert.equal(result.inferenceVerified, false); assert.ok(!JSON.stringify(result).includes('private'));
});

test('offline job retains idea, checkpoint and finite attempt budget across worker restart', async () => {
  const path='.local/tests/network-'+randomUUID()+'.sqlite', store = new Store(path);
  let calls=0;
  const route = { route: 'primary' as const, provider: 'synthetic', model: 'fixture', readiness: async () => 'unreachable', complete: async (_m:unknown,_s:unknown,context?:import('../src/transport.ts').GenerationContext) => { calls++;context?.partial('<!doctype html><html>draft','fixture');throw new ProviderFailure('LLM_DNS','fixture','<!doctype html><html>draft'); } };
  const engine = new GenerationEngine([route], { repairs: 0 });
  const jobs = new GenerationJobs(store, engine,undefined,true,{maxCalls:1});
  let id='';
  try {
    id=jobs.create('owner','network-offline-test',{ mode: 'live', spec,telegramConsent:false }).jobId;
    for(let i=0;i<100&&jobs.get('owner',id).stage!=='needs_attention';i++)await new Promise(r=>setTimeout(r,20));
    const failed=jobs.get('owner',id);assert.equal(failed.stage,'needs_attention');assert.equal(failed.errorCode,'LLM_DNS');assert.equal(failed.spec.prompt,spec.prompt);assert.equal(failed.checkpoint,'<!doctype html><html>draft');assert.equal(calls,1);assert.equal(store.list().length,0);
  } finally { await jobs.close(); store.close(); }
  const reopened=new Store(path), restarted=new GenerationJobs(reopened,engine,undefined,true,{maxCalls:1});
  try {assert.equal(restarted.get('owner',id).checkpoint,'<!doctype html><html>draft');assert.equal(restarted.get('owner',id).spec.prompt,spec.prompt);assert.equal(reopened.integrity(),true);assert.equal(calls,1);}
  finally{await restarted.close();reopened.close();}
});

test('transient DNS loss recovers within the existing automatic budget and persists one checked game', async () => {
  const store = new Store(':memory:'); let calls = 0;
  const route = { route: 'primary' as const, provider: 'ollama.com', model: 'gemma4:31b', readiness: async () => 'ready', complete: async () => { if (++calls === 1) { const error=new ProviderFailure('LLM_DNS');error.diagnostic={provider:'ollama.com',route:'direct',stage:'connect',durationMs:1,category:'LLM_DNS'};throw error; } return { code: html, model: 'gemma4:31b' }; } };
  const engine = new GenerationEngine([route], { repairs: 0, check: async () => ({ profiles: [320, 390], offline: true, errors: 0, scope: 'startup-input-pause',rendering:{contract:'canvas-webgl-strict-v2',contexts:['2d'],profiles:[320,390,844]} }) });
  const jobs = new GenerationJobs(store, engine, undefined, true, { maxCalls: 2, retryMs: 10 });
  try {
    const id = jobs.create('owner', 'network-recovery-test', { mode: 'live', spec, telegramConsent: false }).jobId;
    for (let i = 0; i < 350 && jobs.get('owner', id).stage !== 'completed'; i++) await new Promise(r => setTimeout(r, 20));
    const done = jobs.get('owner', id); assert.equal(done.stage, 'completed'); assert.equal(calls, 2); assert.equal(done.attempts, 2); assert.equal(done.history[0].errorCode, 'LLM_DNS');
    assert.equal(store.list().length, 1); assert.equal(store.getVersion(done.versionId!).html, html.trim());
  } finally { await jobs.close(); store.close(); }
});

for (const untrusted of ['proxy', 'origin']) test('TLS rejection independently protects HTTPS ' + untrusted + ' during CONNECT', async t => {
  const other = testCertificate();
  const targetPort = await listen(t, secureServer(untrusted === 'origin' ? other : tls, (_q, r) => r.end('{"data":[]}')));
  const proxy = secureServer(untrusted === 'proxy' ? other : tls);
  proxy.on('connect', (_q, socket) => {
    const upstream = connect(targetPort, '127.0.0.1', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); socket.pipe(upstream); upstream.pipe(socket); });
    upstream.on('error', () => socket.destroy()); socket.on('close', () => upstream.destroy());
  });
  const proxyPort = await listen(t, proxy);
  const result = await new CloudTransport({ base: 'https://ollama.com/v1', key: 'synthetic', model: 'gemma4:31b', networkEnv: () => ({ YAPLIX_LLM_PROXY: 'https://localhost:' + proxyPort }) }).diagnose(AbortSignal.timeout(2000));
  assert.equal(result.network.category, 'LLM_TLS'); assert.equal(result.network.route, 'https-proxy');
});

test('service CLI checks selected/all routes, exits on configuration errors and never invokes inference', () => {
  const bootstrap = 'globalThis.fetch=async(url,init)=>{if(init.method!=="GET"||!String(url).endsWith("/models"))throw Error("INFERENCE_FORBIDDEN");return Response.json({data:[{id:"gemma4:31b"},{id:"openrouter/free"}]});}';
  for (const mode of ['selected', 'all', 'bad-config', 'none']) {
    const result = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(bootstrap), 'scripts/llm-network-check.ts', ...(mode === 'all' ? ['--all'] : [])], {
      encoding: 'utf8', windowsHide: true, timeout: 5000,
      env: { ...process.env, LIVE_PROVIDER: mode === 'none' ? 'none' : 'ollama-cloud', OLLAMA_CLOUD_API_KEY: 'synthetic', CLOUD_API_KEY: 'synthetic', CLOUD_BASE_URL: 'https://openrouter.ai/api/v1', YAPLIX_LLM_NETWORK: mode === 'bad-config' ? 'invalid' : 'direct' }
    });
    assert.equal(result.status, ['bad-config', 'none'].includes(mode) ? 1 : 0);
    const rows = result.stdout.trim().split('\n').map(x => JSON.parse(x));
    assert.equal(rows.length, mode === 'all' ? 2 : 1); assert.ok(rows.every(x => x.inferenceVerified === false));
    if (mode === 'all') assert.deepEqual(rows.map(x => x.provider), ['ollama.com', 'openrouter']);
    if (mode === 'bad-config') assert.equal(rows[0].network.category, 'LLM_NETWORK_CONFIGURATION');
  }
});
