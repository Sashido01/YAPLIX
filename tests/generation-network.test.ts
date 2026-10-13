import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { LocalCodeAdapter } from '../src/live.ts';
import { networkPolicy } from '../src/access.ts';
import { lanAddresses, checkHost, checkPort, persistentLanKey } from '../src/network.ts';
import { connectionQr } from '../src/qr.ts';
import { liveReadiness } from '../src/diagnostics.ts';
import { spec, html } from './helpers.ts';

test('native-dialog regression: one model repair, strict revalidation, complete context and no unsafe persistence',async t=>{
  const bodies:any[]=[];
  const server=createServer((req,res)=>{let body='';req.on('data',bytes=>body+=bytes);req.on('end',()=>{bodies.push(JSON.parse(body));res.end(JSON.stringify({done:true,model:'test-model',message:{content:bodies.length===1?html.replace('</html>','<script>alert("won")</script></html>'):html}}));});});
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));t.after(()=>{server.closeAllConnections();server.close();});
  const artifact=await new LocalCodeAdapter({url:`http://127.0.0.1:${(server.address() as any).port}`,model:'test-model'}).generate(spec,undefined,'llm_code');
  assert.equal(artifact.html,html.trim());assert.equal(artifact.method,'llm_code');assert.equal(bodies.length,2);
  assert.match(bodies[1].messages.at(-1).content,/native-dialogs/);assert.match(bodies[1].messages.at(-2).content,/alert\("won"\)/);
  assert.ok(bodies[1].messages.at(-1).content.endsWith(spec.prompt));
  assert.deepEqual(bodies[1].messages.slice(0,2),bodies[0].messages);
});

test('Arkanoid with arrow controls remains breakout; victory does not become a food theme',async t=>{
  let body:any;const server=createServer((req,res)=>{let data='';req.on('data',bytes=>data+=bytes);req.on('end',()=>{body=JSON.parse(data);res.end(JSON.stringify({done:true,model:'test-model',message:{content:html}}));});});
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));t.after(()=>{server.closeAllConnections();server.close();});
  const request={...spec,genre:'unknown',prompt:'Арканоид: 12 кирпичей, победа после всех кирпичей. Платформа управляется стрелками.'};
  await new LocalCodeAdapter({url:`http://127.0.0.1:${(server.address() as any).port}`,model:'test-model'}).generate(request);
  assert.match(body.messages[0].content,/ЖАНР: ARKANOID/);assert.doesNotMatch(body.messages[0].content,/ЖАНР: ШУТЕР/);
  assert.match(body.messages[1].content,/ЖАНР: breakout/);assert.doesNotMatch(body.messages[1].content,/ТЕМА: еда/);assert.ok(body.messages[1].content.includes(request.prompt));
});

test('model readiness distinguishes unreachable, missing model and ready; DEMO needs no LLM',async t=>{
  let models:unknown[]=[];const server=createServer((_req,res)=>res.end(JSON.stringify({models})));
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const port=(server.address() as any).port;
  t.after(()=>{server.closeAllConnections();server.close();});const adapter=new LocalCodeAdapter({url:`http://127.0.0.1:${port}`,model:'test-model'});
  assert.equal((await liveReadiness()).llmState,'not_configured');assert.equal((await liveReadiness(adapter)).llmState,'model_missing');
  models=[{name:'test-model'}];assert.equal((await liveReadiness(adapter)).liveReady,true);
  await new Promise<void>(done=>server.close(()=>done()));assert.equal((await liveReadiness(adapter)).llmState,'unreachable');
});

test('repair shares the original deadline and propagates cancellation without saving a substitute',async t=>{
  let calls=0;const server=createServer((_req,res)=>{if(++calls===1)res.end(JSON.stringify({done:true,model:'test-model',message:{content:html.replace('</html>','<script>alert("won")</script></html>')}}));});
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));t.after(()=>{server.closeAllConnections();server.close();});
  const adapter=new LocalCodeAdapter({url:`http://127.0.0.1:${(server.address() as any).port}`,model:'test-model',timeoutMs:1000});
  await assert.rejects(adapter.generate(spec),/LLM_TIMEOUT/);assert.equal(calls,2);
});

test('LAN selection lists all private interfaces, retains supplied key, rejects absent host and reports busy port',async t=>{
  assert.equal(persistentLanKey({YAPLIX_ACCESS_KEY:'supplied-key'}),'supplied-key');
  const retained=persistentLanKey({});assert.match(retained,/^[A-Za-z0-9_-]{32,128}$/);assert.equal(persistentLanKey({}),retained);
  const entries=lanAddresses();assert.ok(entries.every(e=>e.name&&e.address));
  const absent=['10.255.255.254','192.168.255.254'].find(ip=>!entries.some(e=>e.address===ip))!;
  assert.throws(()=>checkHost(networkPolicy({YAPLIX_MODE:'lan',YAPLIX_HOST:absent,YAPLIX_ACCESS_KEY:'x'.repeat(32)})),/HOST_NOT_AVAILABLE/);
  const server=createServer();await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));t.after(()=>server.close());
  const port=(server.address() as any).port;await assert.rejects(checkPort(networkPolicy({PORT:String(port)})),/PORT_IN_USE/);
  const doctor=spawnSync(process.execPath,['scripts/maintenance.ts','doctor'],{encoding:'utf8',env:{...process.env,YAPLIX_MODE:'local',YAPLIX_HOST:'127.0.0.1',PORT:String(port),YAPLIX_DB:':memory:',LIVE_PROVIDER:'none',PUBLIC_URL:''}});
  assert.equal(doctor.status,1);assert.ok(JSON.parse(doctor.stdout).failures.includes('PORT_IN_USE'));
});

test('QR refuses loopback, wildcard, public address, credentials and secrets in query/hash',()=>{
  for(const origin of ['http://127.0.0.1:3000','http://localhost:3000','http://0.0.0.0:3000','http://8.8.8.8','http://key@192.168.1.2','http://192.168.1.2/?key=secret','http://192.168.1.2/#secret'])assert.throws(()=>connectionQr(origin),/LAN_QR_UNAVAILABLE/);
  assert.match(connectionQr('http://192.168.1.2:3000'),/^<svg/);
});
