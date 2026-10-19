import test from 'node:test';
import assert from 'node:assert/strict';
import {GenerationEngine} from '../src/live.ts';
import {providerMode} from '../src/transport.ts';
import type {CodeTransport} from '../src/transport.ts';
import type {GenerationContext} from '../src/transport.ts';
import {Fault} from '../src/contracts.ts';
import {SiwcError} from '../src/experimental/siwc.ts';

test('ChatGPT requires manual selection and cannot enter Auto or other provider routes',()=>{
 const routes=['ollama.com','openrouter','chatgpt'].map(provider=>({provider,model:'synthetic',route:'primary',readiness:async()=>'ready',complete:async()=>{throw Error('not sent');}} as CodeTransport));
 const engine=new GenerationEngine(routes);
 assert.equal(providerMode('chatgpt'),'chatgpt');
 assert.deepEqual(engine.routesFor('auto').map(r=>r.provider),['ollama.com']);
 assert.deepEqual(engine.routesFor('ollama-cloud').map(r=>r.provider),['ollama.com']);
 assert.deepEqual(engine.routesFor('openrouter').map(r=>r.provider),['openrouter']);
 assert.deepEqual(engine.routesFor(providerMode('chatgpt')).map(r=>r.provider),['chatgpt']);
});

import {ChatGptTransport,ChatGptSession} from '../src/chatgpt.ts';
import {GenerationJobs} from '../src/jobs.ts';
import {Store} from '../src/store.ts';
import {createApp} from '../src/api.ts';
import {configuredGenerator} from '../src/live.ts';
import {generationMessages} from '../src/generation.ts';
import {BrowserFailure} from '../src/browser-check.ts';
import {offlineChatGpt,connected,ready,localPolicy,completed,sse} from './chatgpt-helper.ts';
import {spec,html} from './helpers.ts';
import {readFileSync,readdirSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFileSync} from 'node:fs';
const request={spec,mode:'live' as const,providerMode:'chatgpt' as const,telegramConsent:false};
const evidence=async()=>({profiles:[320,390,844],offline:true as const,errors:0 as const,scope:'full-html' as const});
async function settled(jobs:GenerationJobs,id:string){for(let i=0;i<300;i++){const job=jobs.get('owner',id);if(['completed','needs_attention','cancelled'].includes(job.stage))return job;await new Promise(r=>setTimeout(r,10));}throw Error('JOB_TIMEOUT');}
function engineFor(session:ChatGptSession,check=evidence){return new GenerationEngine([new ChatGptTransport(session)],{allowLlmRepair:true,check,requestTimeoutMs:1000});}

test('signed server OAuth -> Responses -> unchanged create/edit prompt -> validation -> SQLite reopen, one POST per job',async()=>{
 const seen:any[]=[];let posts=0;
 const {session,directory}=offlineChatGpt(async(input,init)=>{assert.equal(String(input),'https://api.openai.com/v1/responses');assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error');posts++;seen.push(JSON.parse(String(init?.body)));return sse([completed(html)]);});
 const path=resolve(mkdtempSync('.local/chatgpt-db-'),'games.db');let store=new Store(path),jobs=new GenerationJobs(store,engineFor(session));
 try{
  await connected(session);
  const first=jobs.create('owner','create-one',request);assert.equal(jobs.create('owner','create-one',request).jobId,first.jobId);
  const done=await settled(jobs,first.jobId);assert.equal(done.stage,'completed');assert.equal(done.attempts,1);
  const original=store.getVersion(done.versionId!);assert.equal(original.provider,'chatgpt');assert.equal(original.model,'gpt-6.1-sol');
  const edit={...request,spec:{...spec,prompt:'Add enemies'},previousVersionId:original.versionId};
  const edited=await settled(jobs,jobs.create('owner','edit-one',edit).jobId);assert.equal(edited.stage,'completed');
  assert.deepEqual(seen[0],{model:'gpt-6.1-sol',input:generationMessages(spec),reasoning:{effort:'medium'},store:false,stream:true});
  assert.deepEqual(seen[1].input,generationMessages(edit.spec,original));assert.equal(posts,2);
  assert.equal(jobs.create('owner','create-one',request).jobId,first.jobId);assert.equal(posts,2);
  assert.ok(!JSON.stringify(jobs.report('owner',done.jobId)).includes('credential'));
  for(const file of readdirSync(directory))assert.ok(!readFileSync(resolve(directory,file),'utf8').includes('credential'));
  await jobs.close();store.close();store=new Store(path);jobs=new GenerationJobs(store,engineFor(session));
  assert.equal(store.getVersion(edited.versionId!).provider,'chatgpt');assert.equal(jobs.get('owner',done.jobId).attempts,1);
  assert.ok(!readFileSync(path).includes(Buffer.from('offline-access-credential')));assert.equal(posts,2);
 }finally{session.disconnect();await jobs.close();store.close();}
});

for(const [label,response,expected] of [
 ['missing model',()=>sse([{type:'response.completed',response:{status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:html}]}]}}]),'SIWC_MODEL_ACTUAL_NOT_VERIFIED'],
 ['wrong model',()=>sse([completed(html,'other')]),'SIWC_MODEL_ACTUAL_MISMATCH'],
 ['empty',()=>sse([completed('')]),'SIWC_COMPLETED_WITHOUT_TEXT'],
 ['incomplete',()=>sse([{type:'response.incomplete',response:{status:'incomplete'}}]),'SIWC_INFERENCE_INCOMPLETE'],
 ['interrupted',()=>sse([{type:'response.output_text.delta',delta:html}]),'SIWC_STREAM_INTERRUPTED'],
 ['refusal',()=>sse([{type:'response.refusal.delta',delta:'private'}]),'SIWC_REFUSAL'],
 ['invalid HTML',()=>sse([completed('<!DOCTYPE html><html>')]),'LLM_INVALID_HTML'],
 ['oversize',()=>sse([completed('x'.repeat(200001))]),'SIWC_OUTPUT_TOO_LARGE'],
 ...[401,403,429,500,503].map(status=>['HTTP '+status,()=>new Response('private provider error',{status}),status===401||status===403?'SIWC_AUTH_REQUIRED':status===429?'SIWC_RATE_LIMIT':'SIWC_INFERENCE_HTTP'] as const),
] as const)test('failed ChatGPT job has no retry/repair/fallback/Continue POST: '+label,async()=>{
 let posts=0,fallback=0;const {session}=offlineChatGpt(async()=>{posts++;return response();});await connected(session);
 const engine=engineFor(session);engine.routes.push({provider:'ollama.com',model:'gemma4:31b',route:'primary',readiness:async()=>'ready',complete:async()=>{fallback++;return{code:html,model:'gemma4:31b'};}});
 const store=new Store(':memory:');let jobs=new GenerationJobs(store,engine,undefined,true,{retryMs:10});
 try{
  const first=jobs.create('owner','failure-one',request),done=await settled(jobs,first.jobId);assert.equal(done.stage,'needs_attention');assert.equal(done.errorCode,expected);assert.equal(done.attempts,1);assert.equal(posts,1);assert.equal(fallback,0);
  assert.throws(()=>jobs.continue('owner',done.jobId),/CHATGPT_NEW_JOB_REQUIRED/);assert.equal(jobs.create('owner','failure-one',request).jobId,done.jobId);
  await jobs.close();jobs=new GenerationJobs(store,engine);assert.equal(jobs.get('owner',done.jobId).stage,'needs_attention');assert.equal(posts,1);
  assert.ok(!JSON.stringify(done).includes('private provider error'));
 }finally{session.disconnect();await jobs.close();store.close();}
});

test('browser failure permits only local checkpoint validation across Continue/restart',async()=>{
 let posts=0,accept=false;const {session}=offlineChatGpt(async()=>{posts++;return sse([completed(html)]);});await connected(session);
 const engine=engineFor(session,async()=>{if(!accept)throw new BrowserFailure('BROWSER_START_CONTROL','synthetic');return evidence();});const store=new Store(':memory:');let jobs=new GenerationJobs(store,engine);
 try{
  const failed=await settled(jobs,jobs.create('owner','browser-failure',request).jobId);assert.equal(failed.stage,'needs_attention');assert.equal(posts,1);assert.equal(failed.repairUsed,undefined);
  await jobs.close();session.disconnect();accept=true;jobs=new GenerationJobs(store,engine);
  const done=await settled(jobs,jobs.continue('owner',failed.jobId).jobId);assert.equal(done.stage,'completed');assert.equal(posts,1);
 }finally{session.disconnect();await jobs.close();store.close();}
});

test('unconnected job stays blocked after OAuth; two new jobs each have independent durable budget',async()=>{
 let posts=0;const {session}=offlineChatGpt(async()=>{posts++;return sse([completed(html)]);});
 const store=new Store(':memory:');const jobs=new GenerationJobs(store,engineFor(session));
 try{
  const blocked=await settled(jobs,jobs.create('owner','blocked-one',request).jobId);assert.equal(blocked.stage,'needs_attention');assert.equal(blocked.attempts,0);assert.equal(posts,0);
  await connected(session);assert.equal(jobs.get('owner',blocked.jobId).stage,'needs_attention');assert.throws(()=>jobs.continue('owner',blocked.jobId),/CHATGPT_NEW_JOB_REQUIRED/);
  const one=jobs.create('owner','new-job-one',request),two=jobs.create('owner','new-job-two',request);await settled(jobs,one.jobId);await settled(jobs,two.jobId);assert.equal(posts,2);
 }finally{session.disconnect();await jobs.close();store.close();}
});

test('ChatGPT-only configuration keeps default Auto unavailable and requires a durable job',async()=>{
 const {session}=offlineChatGpt(async()=>{throw Error('no HTTP allowed');});const transport=new ChatGptTransport(session),engine=configuredGenerator({},transport)!;
 assert.throws(()=>engine.routesFor('auto'),/LLM_NOT_CONFIGURED/);assert.deepEqual(engine.routesFor('chatgpt'),[transport]);
 await assert.rejects(()=>transport.complete(generationMessages(spec),new AbortController().signal),/CHATGPT_JOB_REQUIRED/);
 assert.equal(session.status().state,'DISCONNECTED');
});

const headers={'Content-Type':'application/json',Origin:'http://127.0.0.1:3210','X-Yaplix-ChatGPT':'owner'};
test('sensitive API requires same Origin and owner action; status does no OAuth; tokens stay private',async()=>{
 let posts=0;const {session}=offlineChatGpt(async()=>{posts++;return sse([completed(html)]);});
 const store=new Store(':memory:'),engine=engineFor(session),jobs=new GenerationJobs(store,engine);
 const app=createApp(store,engine,undefined,localPolicy,undefined,undefined,jobs,undefined,session);
 const post=(path:string,body:unknown={},extra:Record<string,string>=headers)=>app.request('http://127.0.0.1:3210'+path,{method:'POST',headers:extra,body:JSON.stringify(body)});
 try{
  const status=await(await app.request('http://127.0.0.1:3210/api/chatgpt/status')).json();assert.equal(status.state,'DISCONNECTED');assert.equal(posts,0);
  assert.equal((await post('/api/chatgpt/connect',{}, {'Content-Type':'application/json'} as typeof headers)).status,403);
  assert.equal((await post('/api/chatgpt/connect',{}, {...headers,Origin:'http://attacker.invalid'})).status,403);
  assert.equal((await post('/api/chatgpt/connect')).status,202);assert.equal((await post('/api/chatgpt/connect')).status,409);await ready(session);assert.equal(posts,0);
  const created=await post('/api/jobs',{...request,idempotencyKey:'api-create'});assert.equal(created.status,202);const done=await settled(jobs,(await created.json()).jobId);assert.equal(done.stage,'completed');assert.equal(posts,1);
  const repeated=await post('/api/jobs',{...request,idempotencyKey:'api-create'});assert.equal((await repeated.json()).jobId,done.jobId);assert.equal(posts,1);
  assert.equal((await post('/api/jobs',{...request,idempotencyKey:'telegram-attack'},{...headers,'X-Yaplix-Telegram-Session':'fake'})).status,403);
  assert.equal((await post('/api/games',{spec,mode:'live',providerMode:'chatgpt'})).status,400);
  assert.equal((await post('/api/games',{spec,mode:'live'})).status,503);
  const version=store.getVersion(done.versionId!);assert.equal((await post('/api/games/'+version.gameId+'/versions',{spec,previousVersionId:version.versionId,mode:'live',providerMode:'chatgpt'})).status,400);
  const snapshot=await(await app.request('http://127.0.0.1:3210/api/chatgpt/status')).json();assert.deepEqual(Object.keys(snapshot).sort(),['available','connected','error','model','reauthorizationRequired','state']);assert.ok(!JSON.stringify(snapshot).includes('credential'));
  assert.equal((await post('/api/chatgpt/disconnect')).status,200);assert.equal(session.status().connected,false);assert.equal(store.getVersion(version.versionId).html,html.trim());
  const denied=await settled(jobs,jobs.create('owner','after-disconnect',request).jobId);assert.equal(denied.attempts,0);assert.equal(posts,1);
 }finally{session.disconnect();await jobs.close();store.close();}
});

for(const mode of ['lan','https'] as const)test('personal session rejects '+mode+' both at API and worker transport',async()=>{
 let calls=0;const policy={mode,host:mode==='lan'?'192.168.1.10':'127.0.0.1',port:3210,origin:mode==='lan'?'http://192.168.1.10:3210':'https://example.test',key:'a'.repeat(32)};
 const {session}=offlineChatGpt(async()=>{calls++;throw Error('forbidden');},policy);
 assert.throws(()=>session.connect(),/CHATGPT_LOCAL_ONLY/);
 const store=new Store(':memory:'),engine=engineFor(session),jobs=new GenerationJobs(store,engine),app=createApp(store,engine,undefined,policy,undefined,undefined,jobs,undefined,session);
 try{
  const base=policy.origin,remoteHeaders={'Content-Type':'application/json',...(mode==='https'?{'X-Forwarded-Proto':'https'}:{})};
  const login=await app.request(base+'/api/access',{method:'POST',headers:remoteHeaders,body:JSON.stringify({key:policy.key})});const cookie=login.headers.get('set-cookie')!;
  const result=await app.request(base+'/api/chatgpt/connect',{method:'POST',headers:{...remoteHeaders,Cookie:cookie,Origin:base,'X-Yaplix-ChatGPT':'owner'},body:'{}'});assert.equal(result.status,403);
  const status=await(await app.request(base+'/api/chatgpt/status',{headers:{...remoteHeaders,Cookie:cookie}})).json();assert.equal(status.available,false);
  const job=await settled(jobs,jobs.create('owner','remote-worker',request).jobId);assert.equal(job.stage,'needs_attention');assert.equal(job.attempts,0);assert.equal(calls,0);
 }finally{session.disconnect();await jobs.close();store.close();}
});

test('fragmented UTF-8/CRLF, done and final snapshots preserve full HTML exceeding probe limit',async()=>{
 const code=html.replace('</body>','<!--'+('Привет '.repeat(2000))+'--></body>');
 const events=[{type:'response.output_text.delta',delta:code},{type:'response.output_text.done',text:code},completed(code)];
 const wire=Buffer.from(events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join(''));
 let posts=0;const {session}=offlineChatGpt(async()=>{posts++;return new Response(new ReadableStream({start(c){for(let i=0;i<wire.length;i+=13)c.enqueue(wire.subarray(i,i+13));c.close();}}));});await connected(session);
 const store=new Store(':memory:'),jobs=new GenerationJobs(store,engineFor(session));
 try{const done=await settled(jobs,jobs.create('owner','utf8-large',request).jobId);assert.equal(done.stage,'completed');assert.equal(store.getVersion(done.versionId!).html,code.trim());assert.equal(posts,1);}
 finally{session.disconnect();await jobs.close();store.close();}
});

for(const kind of ['timeout','stream error','disconnect'] as const)test('no repeat after '+kind,async()=>{
 let posts=0;let session!:ChatGptSession;
 ({session}=offlineChatGpt(async(_input,init)=>{posts++;return new Response(new ReadableStream({start(c){c.enqueue(Buffer.from('data: '+JSON.stringify({type:'response.output_text.delta',delta:html})+'\n\n'));if(kind==='stream error'){c.error(Error('private payload'));return;}init?.signal?.addEventListener('abort',()=>c.error(Error('aborted')),{once:true});if(kind==='disconnect')queueMicrotask(()=>session.disconnect());}}));}));await connected(session);
 const store=new Store(':memory:'),jobs=new GenerationJobs(store,engineFor(session));
 try{const done=await settled(jobs,jobs.create('owner','cancel-'+kind.replace(' ','-'),request).jobId);assert.equal(done.stage,'needs_attention');assert.equal(posts,1);assert.equal(done.attempts,1);assert.throws(()=>jobs.continue('owner',done.jobId),/CHATGPT_NEW_JOB_REQUIRED/);assert.ok(!JSON.stringify(done).includes('private payload'));}
 finally{session.disconnect();await jobs.close();store.close();}
});

test('expired authorization and server restart clear connection without HTTP',async()=>{
 let posts=0;const {session}=offlineChatGpt(async()=>{posts++;throw Error('forbidden');},localPolicy,1);await connected(session);
 const newServer=new ChatGptSession(localPolicy,{openBrowser:async()=>{throw Error('must not open');}});assert.equal(newServer.status().state,'DISCONNECTED');
 await new Promise(r=>setTimeout(r,1050));assert.equal(session.status().state,'EXPIRED');
 const store=new Store(':memory:'),jobs=new GenerationJobs(store,engineFor(session));
 try{const done=await settled(jobs,jobs.create('owner','expired-token',request).jobId);assert.equal(done.attempts,0);assert.equal(posts,0);}finally{session.disconnect();await jobs.close();store.close();}
});

for(const complete of [false,true])test('crash fixture with committed POST budget never dispatches on worker adoption: '+complete,async()=>{
 let posts=0;const {session}=offlineChatGpt(async()=>{posts++;return sse([completed(html)]);});await connected(session);
 const store=new Store(':memory:');let jobs=new GenerationJobs(store,engineFor(session));
 try{
  const job=jobs.create('owner','crash-fixture',request);await jobs.close();
  // Persist the crash boundary: reservation committed, remote outcome unknown.
  const saved=jobs.get('owner',job.jobId);store.db.prepare('UPDATE generation_jobs SET status=?,attempts=1,checkpoint=?,metadata=? WHERE job_id=?').run('generating',complete?html:'<!DOCTYPE html>',JSON.stringify({...saved,provider:'chatgpt',actualModel:complete?'gpt-6.1-sol':null,checkpointOrigin:complete?{provider:'chatgpt',requestedModel:'gpt-6.1-sol',model:'gpt-6.1-sol'}:undefined,attempts:undefined,checkpoint:undefined,stage:undefined}),job.jobId);
  jobs=new GenerationJobs(store,engineFor(session),undefined,true,{retryMs:10});const done=await settled(jobs,job.jobId);assert.equal(done.stage,complete?'completed':'needs_attention');assert.equal(done.attempts,1);assert.equal(posts,0);
 }finally{session.disconnect();await jobs.close();store.close();}
});

test('result persistence failure cannot spend a second POST',async t=>{
 let posts=0;const {session}=offlineChatGpt(async()=>{posts++;return sse([completed(html)]);});await connected(session);
 const store=new Store(':memory:');t.mock.method(store,'saveAndCompleteJob',()=>{throw Error('synthetic disk unavailable');});const jobs=new GenerationJobs(store,engineFor(session));
 try{const done=await settled(jobs,jobs.create('owner','save-failure',request).jobId);assert.equal(done.stage,'needs_attention');assert.equal(done.errorCode,'JOB_PERSISTENCE_ERROR');assert.equal(posts,1);await settled(jobs,jobs.continue('owner',done.jobId).jobId);assert.equal(posts,1);}
 finally{session.disconnect();await jobs.close();store.close();}
});

test('OAuth revoked between create and queued dispatch prevents POST',async()=>{
 let posts=0;const {session}=offlineChatGpt(async()=>{posts++;return sse([completed(html)]);});await connected(session);
 const store=new Store(':memory:'),jobs=new GenerationJobs(store,engineFor(session));
 try{const job=jobs.create('owner','dispatch-revoked',request);session.disconnect();const done=await settled(jobs,job.jobId);assert.equal(done.attempts,0);assert.equal(posts,0);await connected(session);assert.equal(jobs.get('owner',job.jobId).stage,'needs_attention');}
 finally{session.disconnect();await jobs.close();store.close();}
});

test('abrupt server termination during OAuth permits explicit reconnect and preserves CLI locks',async()=>{
 const directory=resolve(mkdtempSync('.local/chatgpt-crash-'));
 const cliLock=resolve(directory,'authorization.lock');writeFileSync(cliLock,'pending\n');
 const child=spawn(process.execPath,['--input-type=module','--eval',`
  import {ChatGptSession} from './src/chatgpt.ts';
  import {SIWC} from './src/experimental/siwc.ts';
  const session=new ChatGptSession({mode:'local',host:'127.0.0.1',port:3210},{
   directory:${JSON.stringify(directory)},request:async()=>Response.json({issuer:SIWC.issuer,authorization_endpoint:SIWC.authorize,token_endpoint:SIWC.token,jwks_uri:SIWC.jwks}),
   openBrowser:async()=>{process.stdout.write('CONNECTING');await new Promise(()=>{});}
  });session.connect();
 `],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 try{
  const data=await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('CHILD_EXITED_EARLY');}),new Promise<never>((_,no)=>setTimeout(()=>no(Error('CHILD_TIMEOUT')),5000).unref())]);
  assert.match(String(data[0]),/CONNECTING/);const exited=once(child,'exit');child.kill();await exited;
  let posts=0;const {session}=offlineChatGpt(async()=>{posts++;throw Error('must not infer');},localPolicy,3600,directory);
  try{await connected(session);assert.equal(session.status().connected,true);assert.equal(posts,0);assert.equal(readFileSync(cliLock,'utf8'),'pending\n');}
  finally{session.disconnect();}
 }finally{child.kill();}
});

for(const [code,status] of [['JOB_STORAGE_QUOTA',507],['JOB_WORKER_BUSY',409],['CHATGPT_BUDGET_SPENT',409]] as const)
test('A1.2 pre-dispatch Fault retains its code without HTTP or private fields: '+code,async()=>{
 let posts=0,fallback=0;const {session}=offlineChatGpt(async()=>{posts++;return sse([completed(html)]);});await connected(session);
 const transport=new ChatGptTransport(session),engine=engineFor(session);
 engine.routes.push({provider:'ollama.com',model:'gemma4:31b',route:'primary',readiness:async()=>'ready',complete:async()=>{fallback++;return{code:html,model:'gemma4:31b'};}});
 const failure=Object.assign(new Fault(code,status),{privatePayload:'offline-access-credential SQL private details'});
 const context:GenerationContext={durableJob:true,providerMode:'chatgpt',stage:()=>{},partial:()=>{},attempt:()=>{},dispatch:()=>{throw failure;}};
 try{
  await assert.rejects(()=>transport.complete(generationMessages(spec),new AbortController().signal,context),(error:unknown)=>{
   assert.ok(error instanceof Fault);assert.equal(error.code,code);assert.equal(error.status,status);
   assert.ok(!JSON.stringify(error).includes('privatePayload'));return true;
  });
  await assert.rejects(()=>engine.generate(spec,undefined,'llm_code',undefined,context),(error:any)=>{
   assert.equal(error.code,code);assert.equal(error.attempts.length,1);assert.equal(error.attempts[0].errorCode,code);
   assert.ok(!JSON.stringify(error).includes('credential'));assert.ok(!JSON.stringify(error).includes('private details'));return true;
  });
  assert.equal(posts,0);assert.equal(fallback,0);
 }finally{session.disconnect();}
});

test('A1.2 SQLite reservation failure preserves the unspent job and safe diagnostics without retry',async()=>{
 let posts=0;const {session}=offlineChatGpt(async()=>{posts++;return sse([completed(html)]);});await connected(session);
 const store=new Store(':memory:'),jobs=new GenerationJobs(store,engineFor(session),undefined,true,{retryMs:10});
 store.db.exec("CREATE TEMP TRIGGER reject_reservation BEFORE UPDATE OF attempts ON generation_jobs WHEN NEW.attempts>OLD.attempts BEGIN SELECT RAISE(ABORT,'offline-access-credential private SQLite details'); END");
 try{
  const done=await settled(jobs,jobs.create('owner','sqlite-reservation',request).jobId);
  assert.equal(done.stage,'needs_attention');assert.equal(done.attempts,0);assert.equal(done.errorCode,'SIWC_DISPATCH_FAILED');assert.equal(posts,0);
  assert.throws(()=>jobs.continue('owner',done.jobId),/CHATGPT_NEW_JOB_REQUIRED/);
  assert.ok(!JSON.stringify(jobs.report('owner',done.jobId)).includes('credential'));
  assert.ok(!JSON.stringify(jobs.summary(done)).includes('private SQLite details'));
 }finally{session.disconnect();await jobs.close();store.close();}
});

test('A1.2 pre-dispatch SiwcError retains its safe code',async()=>{
 let posts=0;const {session}=offlineChatGpt(async()=>{posts++;return sse([completed(html)]);});await connected(session);
 try{
  const context:GenerationContext={durableJob:true,providerMode:'chatgpt',stage:()=>{},partial:()=>{},attempt:()=>{},dispatch:()=>{throw new SiwcError('SIWC_PLAN_PERMISSION_REQUIRED');}};
  await assert.rejects(()=>new ChatGptTransport(session).complete(generationMessages(spec),new AbortController().signal,context),/SIWC_PLAN_PERMISSION_REQUIRED/);assert.equal(posts,0);
 }finally{session.disconnect();}
});

test('A1.2 network failure after successful reservation spends one POST across Continue and restart',async()=>{
 let posts=0;const {session}=offlineChatGpt(async()=>{posts++;throw Error('offline-access-credential private network details');});await connected(session);
 const store=new Store(':memory:'),engine=engineFor(session);let jobs=new GenerationJobs(store,engine,undefined,true,{retryMs:10});
 try{
  const done=await settled(jobs,jobs.create('owner','network-reservation',request).jobId);
  assert.equal(done.stage,'needs_attention');assert.equal(done.attempts,1);assert.equal(done.errorCode,'SIWC_NETWORK');assert.equal(posts,1);
  assert.throws(()=>jobs.continue('owner',done.jobId),/CHATGPT_NEW_JOB_REQUIRED/);
  await jobs.close();jobs=new GenerationJobs(store,engine);assert.equal(jobs.get('owner',done.jobId).attempts,1);assert.equal(jobs.get('owner',done.jobId).stage,'needs_attention');assert.equal(posts,1);
  assert.ok(!JSON.stringify(jobs.report('owner',done.jobId)).includes('credential'));assert.ok(!JSON.stringify(jobs.list('owner')).includes('private network details'));
 }finally{session.disconnect();await jobs.close();store.close();}
});

for(const [label,checkpoint,origin,allowed] of [
 ['empty','',undefined,false],
 ['partial','<!DOCTYPE html><html><body>',{provider:'chatgpt',requestedModel:'gpt-6.1-sol',model:'gpt-6.1-sol'},false],
 ['unknown model',html,undefined,false],
 ['wrong model',html,{provider:'chatgpt',requestedModel:'gpt-6.1-sol',model:'other'},false],
 ['wrong provider',html,{provider:'ollama.com',requestedModel:'gpt-6.1-sol',model:'gpt-6.1-sol'},false],
 ['wrong requested model',html,{provider:'chatgpt',requestedModel:'other',model:'gpt-6.1-sol'},false],
 ['confirmed full HTML',html,{provider:'chatgpt',requestedModel:'gpt-6.1-sol',model:'gpt-6.1-sol'},true],
] as const)test('A1.2 Continue summary agrees with server after restart and OAuth disconnect: '+label,async()=>{
 let posts=0;const {session}=offlineChatGpt(async()=>{posts++;return sse([completed(html)]);});await connected(session);
 const store=new Store(':memory:'),engine=engineFor(session);let jobs=new GenerationJobs(store,engine);
 try{
  const created=jobs.create('owner','continue-policy',request);await jobs.close();session.disconnect();
  const saved=jobs.get('owner',created.jobId);
  // Durable recovery fixtures describe a spent POST and preserved source.
  store.db.prepare('UPDATE generation_jobs SET status=?,attempts=1,checkpoint=?,metadata=? WHERE job_id=?').run('needs_attention',checkpoint,JSON.stringify({...saved,provider:'chatgpt',requestedModel:'gpt-6.1-sol',actualModel:origin?.model??null,checkpointOrigin:origin,attempts:undefined,checkpoint:undefined,stage:undefined}),created.jobId);
  jobs=new GenerationJobs(store,engine);
  const summary=jobs.list('owner')[0];assert.equal(summary.canContinue,allowed);assert.ok(!Object.hasOwn(summary,'checkpoint'));
  const app=createApp(store,engine,undefined,localPolicy,undefined,undefined,jobs,undefined,session);
  const response=await app.request('http://127.0.0.1:3210/api/jobs/'+created.jobId+'/continue',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:3210','X-Yaplix-ChatGPT':'owner'},body:'{}'});
  assert.equal(response.status,allowed?200:409);
  if(allowed){const done=await settled(jobs,created.jobId);assert.equal(done.stage,'completed');assert.equal(done.attempts,1);assert.equal(jobs.summary(done).canContinue,false);}
  else assert.equal((await response.json()).error,'CHATGPT_NEW_JOB_REQUIRED');
  assert.equal(posts,0);
 }finally{session.disconnect();await jobs.close();store.close();}
});

for(const mode of ['ollama-cloud','openrouter'] as const)test('A1.2 Continue keeps existing queue refusal status for '+mode,async()=>{
 const store=new Store(':memory:'),jobs=new GenerationJobs(store);
 try{
  const demo={spec,mode:'demo' as const,providerMode:mode,telegramConsent:false};
  const first=jobs.create('owner','existing-continue',demo);jobs.cancel('owner',first.jobId);
  assert.equal(jobs.list('owner')[0].canContinue,true);
  for(let i=0;i<3;i++)jobs.create('owner','fill-queue-'+i,demo);
  assert.equal(jobs.summary(jobs.get('owner',first.jobId)).canContinue,false);
  assert.throws(()=>jobs.continue('owner',first.jobId),(error:unknown)=>{assert.ok(error instanceof Fault);assert.equal(error.code,'JOB_QUEUE_FULL');assert.equal(error.status,429);return true;});
 }finally{await jobs.close();store.close();}
});
