import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,readdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store,managedPath,healthyDatabase} from '../src/store.ts';
import {GenerationJobs} from '../src/jobs.ts';
import {GenerationEngine,configuredGenerator} from '../src/live.ts';
import {CloudTransport,CloudOutputFailure,ProviderFailure} from '../src/transport.ts';
import type {CodeTransport,Message,GenerationContext} from '../src/transport.ts';
import {Fault} from '../src/contracts.ts';
import {createApp} from '../src/api.ts';
import {TelegramSessions} from '../src/telegram.ts';
import {spec,html,artifact} from './helpers.ts';
const evidence=async()=>({profiles:[320,390],offline:true as const,errors:0 as const,scope:'startup-input-pause' as const});
const route=(complete:CodeTransport['complete'],name:'primary'|'secondary'|'local'='primary'):CodeTransport=>({route:name,provider:'synthetic',model:'requested',complete,readiness:async()=>'ready'});
const request={spec,mode:'live' as const,telegramConsent:false};
async function settled(jobs:GenerationJobs,id:string,owner='owner') {for(let i=0;i<550;i++){const job=jobs.get(owner,id);if(['completed','needs_attention','cancelled','failed'].includes(job.stage))return job;await new Promise(done=>setTimeout(done,20));}throw Error('JOB_NOT_SETTLED');}
const stream=(content:string,finish='stop',tokens={completion_tokens:300,completion_tokens_details:{reasoning_tokens:12}})=>new Response('data: '+JSON.stringify({model:'actual',choices:[{delta:{content},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({model:'actual',choices:[{delta:{},finish_reason:finish}],usage:tokens})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});

test('jobs are idempotent, owner filtered, detached from HTTP, atomic and claim notification once',async()=>{
  const store=new Store(':memory:');let release!:()=>void;const held=new Promise<void>(done=>release=done);let calls=0;
  const engine=new GenerationEngine([route(async()=>{calls++;await held;return{code:html,model:'actual'};})],{check:evidence});const jobs=new GenerationJobs(store,engine);
  try{
    const job=jobs.create('owner','same-key-123',request);assert.equal(jobs.create('owner','same-key-123',request).jobId,job.jobId);
    assert.throws(()=>jobs.create('owner','same-key-123',{...request,spec:{...spec,prompt:'different'}}),/IDEMPOTENCY_CONFLICT/);
    assert.throws(()=>jobs.get('other',job.jobId),/JOB_NOT_FOUND/);assert.throws(()=>jobs.cancel('other',job.jobId),/JOB_NOT_FOUND/);assert.throws(()=>jobs.continue('other',job.jobId),/JOB_NOT_FOUND/);assert.deepEqual(jobs.list('other'),[]);
    const app=createApp(store,engine,undefined,undefined,undefined,undefined,jobs),controller=new AbortController();
    const response=await app.request('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,idempotencyKey:'http-key-123'}),signal:controller.signal});assert.equal(response.status,202);controller.abort();release();
    const done=await settled(jobs,job.jobId);assert.equal(done.stage,'completed');assert.equal(done.spec.prompt,spec.prompt);assert.equal(done.attempts,1);assert.equal(store.getVersion(done.versionId!).validationStatus,'passed');assert.equal(jobs.claim('owner',job.jobId),true);assert.equal(jobs.claim('owner',job.jobId),false);
    await settled(jobs,(await response.json()).jobId);assert.equal(calls,2);assert.equal(store.list().length,2);
    assert.equal((await app.request('/api/jobs/'+job.jobId,{headers:{Host:'attacker.test'}})).status,403);
  }finally{release();await jobs.close();store.close();}
});

test('output length preserves checkpoint and uses bounded complete-document repair with original request',async()=>{
  const store=new Store(':memory:');const seen:Message[][]=[];let calls=0;
  const engine=new GenerationEngine([route(async(messages,_signal,context)=>{seen.push(structuredClone(messages));calls++;if(calls===1){context!.partial('<!DOCTYPE html><html>','actual',{outputTokens:4000,reasoningTokens:500});throw new CloudOutputFailure('actual','<!DOCTYPE html><html>',{outputTokens:4000,reasoningTokens:500});}return{code:html,model:'actual',outputTokens:700,reasoningTokens:0};})],{check:evidence});const jobs=new GenerationJobs(store,engine);
  try{const result=await settled(jobs,jobs.create('owner','length-key',request).jobId);assert.equal(result.stage,'completed');assert.equal(result.history.length,2);assert.equal(result.history[0].errorCode,'LLM_OUTPUT_TRUNCATED');assert.equal(result.history[0].reasoningTokens,500);assert.equal(result.outputTokens,700);assert.ok(seen[1].at(-1)!.content.includes(spec.prompt));assert.ok(seen[1].at(-2)!.content.includes('<!DOCTYPE html><html>'));assert.equal(result.checkpoint.trim(),html.trim());assert.equal(calls,2);}finally{await jobs.close();store.close();}
});
test('finish stop with incomplete HTML repairs the actual raw draft, not an empty placeholder',async()=>{
  const store=new Store(':memory:'),partial='<!DOCTYPE html><html><body><script>const score=0;';let calls=0;const messages:Message[][]=[];
  const jobs=new GenerationJobs(store,new GenerationEngine([route(async m=>{messages.push(structuredClone(m));return{code:++calls===1?partial:html,model:'actual'};})],{check:evidence}));
  try{const done=await settled(jobs,jobs.create('owner','incomplete-key',request).jobId);assert.equal(done.stage,'completed');assert.equal(calls,2);assert.equal(messages[1].at(-2)!.content,partial);assert.ok(messages[1].at(-1)!.content.includes(spec.prompt));assert.equal(done.history[0].errorCode,'LLM_INVALID_HTML');assert.equal(store.list().length,1);}finally{await jobs.close();store.close();}
});

for(const [status,code] of [[429,'LLM_RATE_LIMIT'],[402,'LLM_QUOTA'],[400,'LLM_CONTEXT_LIMIT']] as const)test(`controlled HTTP ${status}: explicitly configured backup recovers without repeating refused route`,async t=>{
  const store=new Store(':memory:');let calls=0,backup=0;
  t.mock.method(globalThis,'fetch',async(url:unknown)=>{if(String(url).endsWith('/models'))return Response.json({data:[{id:'requested'}]});calls++;return new Response('maximum context length; synthetic private text',{status,headers:status===429?{'Retry-After':'2'}:{}});});
  const cloud=new CloudTransport({base:'http://127.0.0.1:9991/v1',key:'synthetic-key',model:'requested'});const engine=new GenerationEngine([cloud,route(async()=>{backup++;return{code:html,model:'backup'};},'secondary')],{check:evidence});const jobs=new GenerationJobs(store,engine);
  try{const job=await settled(jobs,jobs.create('owner','error-'+status,request).jobId);assert.equal(job.stage,'completed');assert.equal(job.spec.prompt,spec.prompt);assert.equal(calls,1);assert.equal(backup,1);assert.equal(job.history[0].errorCode,code);assert.ok(!JSON.stringify(job).includes('private text'));}finally{await jobs.close();store.close();}
});

test('SSE chunks persist bounded partials, usage and cap advertised output; interruption needs manual continuation',async t=>{
  const store=new Store(':memory:');let mode='interrupted',calls=0;const bodies:any[]=[];
  t.mock.method(globalThis,'fetch',async(url:unknown,options:any)=>{
    if(String(url).endsWith('/models'))return Response.json({data:[{id:'requested',top_provider:{max_completion_tokens:4096}}]});
    calls++;bodies.push(JSON.parse(options.body));if(mode==='success')return stream(html);
    const first='<!DOCTYPE html><html>'+(' '.repeat(5000));return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({model:'actual',choices:[{delta:{content:first}}]})+'\n\n'));},pull(controller){controller.error(Error('synthetic lost network'));}}));
  });
  const jobs=new GenerationJobs(store,new GenerationEngine([new CloudTransport({base:'http://127.0.0.1:9991/v1',key:'synthetic-key',model:'requested'})],{allowLlmRepair:true,check:evidence}));
  try{const job=await settled(jobs,jobs.create('owner','stream-key',request).jobId);assert.equal(job.errorCode,'LLM_CONNECTION_INTERRUPTED');assert.ok(job.checkpoint.includes('<html>'));assert.ok(job.checkpointAt);assert.equal(calls,1);assert.equal(bodies[0].max_tokens,4096);assert.equal(bodies[0].stream,true);mode='success';const later=Date.now()+5001;t.mock.method(Date,'now',()=>later);jobs.continue('owner',job.jobId);const done=await settled(jobs,job.jobId);assert.equal(done.stage,'completed');assert.ok(bodies[1].messages.some((m:Message)=>m.content.includes(job.checkpoint)));assert.equal(done.outputTokens,300);assert.equal(done.reasoningTokens,12);assert.equal(store.list().length,1);}finally{await jobs.close();store.close();}
});

test('explicit available backup carries useful draft; no configured route leaves recoverable request',async()=>{
  const store=new Store(':memory:');let seen:Message[]=[];
  const primary=route(async(_m,_s,context)=>{context!.partial('<!doctype html><html>draft','primary-actual');throw new ProviderFailure('LLM_HTTP');});
  const secondary=route(async m=>{seen=m;return{code:html,model:'backup-actual'};},'secondary');
  const jobs=new GenerationJobs(store,new GenerationEngine([primary,secondary],{check:evidence}));
  try{const done=await settled(jobs,jobs.create('owner','backup-key',request).jobId);assert.equal(done.stage,'completed');assert.equal(done.actualModel,'backup-actual');assert.equal(done.history[1].route,'secondary');assert.ok(seen.some(m=>m.content.includes('<html>draft')));assert.ok(seen.some(m=>m.content.includes(spec.prompt)));}finally{await jobs.close();store.close();}
  const plain=new Store(':memory:'),drafts=new GenerationJobs(plain);try{const draft=await settled(drafts,drafts.create('owner','no-backup-key',request).jobId);assert.equal(draft.errorCode,'LLM_NOT_CONFIGURED');assert.equal(draft.spec.prompt,spec.prompt);assert.equal(draft.stage,'needs_attention');}finally{await drafts.close();plain.close();}
  const configured=configuredGenerator({CLOUD_API_KEY:'synthetic',LLM_FALLBACK:'ollama-cloud',OLLAMA_CLOUD_API_KEY:'synthetic',OLLAMA_CLOUD_MODEL:'api-confirmed-placeholder',LLM_LOCAL_FALLBACK:'1'});assert.deepEqual(configured!.routes.map(r=>[r.provider,r.model]),[['ollama.com','gemma4:31b'],['openrouter','openrouter/free']]);assert.equal(configuredGenerator({}) ,undefined);
});

test('one DB worker owns recovery; shutdown/restart keeps uncertain sent request and queued jobs safe',async()=>{
  const store=new Store(':memory:');let calls=0;
  const engine=new GenerationEngine([route(async(_m,signal,context)=>{calls++;context!.partial('<!doctype html><html>saved','actual');return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true}));})],{check:evidence});
  let jobs=new GenerationJobs(store,engine);const job=jobs.create('owner','restart-key',request);await new Promise(done=>setTimeout(done,20));assert.equal(jobs.get('owner',job.jobId).stage,'generating');
  assert.throws(()=>new GenerationJobs(store,engine),/JOB_WORKER_BUSY/);assert.equal(jobs.get('owner',job.jobId).stage,'generating');assert.equal(calls,1);
  await jobs.close();assert.equal(jobs.get('owner',job.jobId).errorCode,'JOB_RESTART_UNCERTAIN');store.db.prepare("UPDATE generation_jobs SET status='generating' WHERE job_id=?").run(job.jobId);
  jobs=new GenerationJobs(store,engine);try{assert.equal(jobs.get('owner',job.jobId).stage,'needs_attention');assert.equal(jobs.get('owner',job.jobId).checkpoint,'<!doctype html><html>saved');await new Promise(done=>setTimeout(done,30));assert.equal(calls,1);}finally{await jobs.close();store.close();}
});

test('failed completion transaction rolls back version and preserves draft; quotas bound jobs and calls',async()=>{
  const store=new Store(':memory:');const jobs=new GenerationJobs(store,new GenerationEngine([route(async()=>({code:html,model:'actual'}))],{check:evidence}));
  try{store.db.exec("CREATE TRIGGER synthetic_failure BEFORE UPDATE OF status ON generation_jobs WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'synthetic atomic failure'); END;");const failed=await settled(jobs,jobs.create('owner','atomic-key',request).jobId);assert.equal(failed.stage,'needs_attention');assert.equal(store.list().length,0);assert.ok(failed.checkpoint.includes('</html>'));store.db.exec('DROP TRIGGER synthetic_failure');jobs.continue('owner',failed.jobId);assert.equal((await settled(jobs,failed.jobId)).stage,'completed');assert.equal(store.list().length,1);store.db.prepare('UPDATE generation_jobs SET attempts=12,status=? WHERE job_id=?').run('needs_attention',failed.jobId);assert.throws(()=>jobs.continue('owner',failed.jobId),/JOB_ATTEMPT_LIMIT/);}finally{await jobs.close();store.close();}
});

test('v1 migration protects old immutable games/events and validates both legacy and v2 backup',async()=>{
  const base=managedPath('.local/tests/jobs-migration-');const directory=mkdtempSync(base),path=resolve(directory,'data.sqlite');let store=new Store(path);const before=store.save(spec,artifact);store.db.exec('DROP INDEX generation_jobs_status; DROP INDEX generation_jobs_owner; DROP TABLE generation_jobs; DROP TABLE generation_worker; PRAGMA user_version=1');store.close();
  const snapshotsBefore=new Set(readdirSync(managedPath('.local/backups/marker',true).replace(/[\\/]marker$/,'')));
  let snapshot:string|undefined;
  try{store=new Store(path);assert.deepEqual(store.getVersion(before.versionId),before);assert.equal(store.db.prepare('PRAGMA user_version').get()?.user_version,2);assert.ok(store.integrity());const backupDirectory=resolve(managedPath('.local/backups/marker',false),'..');snapshot=readdirSync(backupDirectory).find(name=>!snapshotsBefore.has(name)&&name.startsWith('before-v2-'));assert.ok(snapshot);const old=new DatabaseSync(resolve(backupDirectory,snapshot!),{readOnly:true});try{assert.equal(old.prepare('PRAGMA user_version').get()?.user_version,1);assert.ok(healthyDatabase(old));assert.equal(old.prepare('SELECT html FROM versions').get()?.html,before.html);}finally{old.close();}const copy=await store.backup();assert.equal(copy.schemaVersion,2);assert.ok(readFileSync(resolve(backupDirectory,copy.filename)).length>0);rmSync(resolve(backupDirectory,copy.filename));}finally{store.close();if(snapshot)rmSync(managedPath('.local/backups/'+snapshot));rmSync(directory,{recursive:true});}
});

test('Telegram notification requires own consent/HTTPS identity and validates acknowledgement (synthetic)',async t=>{
  let calls=0;let response:unknown={ok:false,error_code:400};t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json(response);});
  const telegram=new TelegramSessions({TELEGRAM_BOT_TOKEN:'synthetic-bot-token',TELEGRAM_ALLOWED_USER_IDS:'123'});
  assert.equal(await telegram.notifyReady('other',randomUUID(),randomUUID(),'https://yaplix.test'),'unavailable');assert.equal(calls,0);
  assert.equal(await telegram.notifyReady('123',randomUUID(),randomUUID(),'https://yaplix.test'),'unavailable');response={ok:true};assert.equal(await telegram.notifyReady('123',randomUUID(),randomUUID(),'https://yaplix.test'),'unknown');response={ok:true,result:{message_id:1,chat:{id:123}}};assert.equal(await telegram.notifyReady('123',randomUUID(),randomUUID(),'https://yaplix.test'),'sent');
});
test('consented bot notification waits for Mini App absence, claims once, and retains unknown acknowledgement',async t=>{
  t.mock.timers.enable({apis:['setInterval']});let clock=Date.now(),calls=0;t.mock.method(Date,'now',()=>clock);
  const store=new Store(':memory:'),jobs=new GenerationJobs(store,undefined,async(owner)=>{assert.equal(owner,'123');calls++;return'unknown';});
  try{const job=await settled(jobs,jobs.create('123','notification-key',{spec,mode:'demo',telegramConsent:true}).jobId,'123');jobs.list('123');clock+=1000;t.mock.timers.tick(5000);await Promise.resolve();assert.equal(calls,0);clock+=31000;t.mock.timers.tick(5000);await Promise.resolve();assert.equal(calls,1);assert.equal(jobs.get('123',job.jobId).telegramState,'unknown');t.mock.timers.tick(10000);await Promise.resolve();assert.equal(calls,1);}finally{await jobs.close();store.close();}
});

test('429 resumes automatically after Retry-After without holding the worker; one final version',async()=>{
 const store=new Store(':memory:');let calls=0;const times:number[]=[];let retryAt=0;
 const primary=route(async()=>{times.push(Date.now());if(++calls===1){retryAt=Date.now()+80;throw new ProviderFailure('LLM_RATE_LIMIT',null,'',{},retryAt,429);}return{code:html,model:'actual'};});
 const jobs=new GenerationJobs(store,new GenerationEngine([primary],{check:evidence}),undefined,true,{retryMs:10});
 try{const id=jobs.create('owner','automatic-429',request).jobId;await new Promise(r=>setTimeout(r,20));const waiting=jobs.get('owner',id);assert.equal(waiting.stage,'queued');assert.equal(waiting.recoveryState,'waiting_for_provider');assert.equal(calls,1);const done=await settled(jobs,id);assert.equal(done.stage,'completed');assert.equal(calls,2);assert.ok(times[1]>=retryAt);assert.equal(store.list().length,1);assert.equal(done.notificationClaimed,false);}finally{await jobs.close();store.close();}
});

test('per-request timeout automatically falls back without retrying unknown billed request',async()=>{
 const store=new Store(':memory:');let primaryCalls=0,secondaryCalls=0;
 const primary={...route(async(_m,signal,ctx)=>{primaryCalls++;ctx!.partial('<!doctype html><html>checkpoint','first');return new Promise<any>((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));}),provider:'ollama.com'};
 const backup=route(async m=>{secondaryCalls++;assert.ok(m.some(v=>v.content.includes('checkpoint')));return{code:html,model:'backup'};},'secondary');
 const jobs=new GenerationJobs(store,new GenerationEngine([primary,backup],{check:evidence,timeoutMs:4000,requestTimeoutMs:1000}));
 try{const done=await settled(jobs,jobs.create('owner','timeout-fallback',request).jobId);assert.equal(done.stage,'completed');assert.equal(done.history[0].errorCode,'LLM_TIMEOUT');assert.equal(primaryCalls,1);assert.equal(secondaryCalls,1);assert.ok(done.blockedRoutes?.includes('ollama.com/requested'));assert.equal(store.list().length,1);}finally{await jobs.close();store.close();}
});

test('durable waiting job survives restart, bounded request budget terminates repeated refusal',async()=>{
 const store=new Store(':memory:');let calls=0;
 const engine=new GenerationEngine([route(async()=>{calls++;throw new ProviderFailure('LLM_RATE_LIMIT',null,'',{},Date.now()+80,429);})],{check:evidence});
 let jobs=new GenerationJobs(store,engine,undefined,true,{maxCalls:2,retryMs:10});const id=jobs.create('owner','restart-cooldown',request).jobId;
 await new Promise(r=>setTimeout(r,20));assert.equal(jobs.get('owner',id).stage,'queued');await jobs.close();
 jobs=new GenerationJobs(store,engine,undefined,true,{maxCalls:2,retryMs:10});
 try{assert.equal(calls,1);const done=await settled(jobs,id);assert.equal(done.stage,'needs_attention');assert.equal(done.attempts,2);assert.equal(calls,2);assert.equal(done.spec.prompt,spec.prompt);await new Promise(r=>setTimeout(r,180));assert.equal(calls,2);assert.equal(store.list().length,0);}finally{await jobs.close();store.close();}
});

test('complete checkpoint is browser-validated after restart with zero repeated provider dispatch',async()=>{
 const store=new Store(':memory:');let calls=0;
 const engine=new GenerationEngine([{...route(async(_m,signal,context)=>{calls++;context!.partial(html,'actual');return new Promise<any>((_,reject)=>signal.addEventListener('abort',()=>reject(Error('shutdown')),{once:true}));}),provider:'ollama.com'}],{check:evidence});
 let jobs=new GenerationJobs(store,engine,undefined,true,{retryMs:10});const id=jobs.create('owner','restart-complete',request).jobId;await new Promise(r=>setTimeout(r,20));await jobs.close();
 store.db.prepare("UPDATE generation_jobs SET status='validating' WHERE job_id=?").run(id);
 jobs=new GenerationJobs(store,engine,undefined,true,{retryMs:10});try{const done=await settled(jobs,id);assert.equal(done.stage,'completed');assert.equal(calls,1);assert.equal(done.history.at(-1)?.requestMs,0);assert.equal(store.list().length,1);assert.ok(store.getVersion(done.versionId!).generation);}finally{await jobs.close();store.close();}
});

test('legacy recoverable draft automatically adopts one bounded cycle; cancellation stays cancelled',async()=>{
 const store=new Store(':memory:');let jobs=new GenerationJobs(store);const id=jobs.create('owner','legacy-timeout',request).jobId;await settled(jobs,id);const cancelled=jobs.create('owner','legacy-cancel',request).jobId;jobs.cancel('owner',cancelled);await jobs.close();
 store.db.prepare("UPDATE generation_jobs SET attempts=2,metadata=json_set(json_remove(metadata,'$.automaticLimit','$.automaticRuns','$.deadlineAt'),'$.errorCode','LLM_TIMEOUT','$.provider','openrouter','$.requestedModel','specific:free') WHERE job_id=?").run(id);
 let calls=0;jobs=new GenerationJobs(store,new GenerationEngine([{...route(async()=>{calls++;return{code:html,model:'actual'};}),provider:'ollama.com',model:'gemma4:31b'}],{check:evidence}),undefined,true,{maxCalls:2,retryMs:10});
 try{const done=await settled(jobs,id);assert.equal(done.stage,'completed');assert.equal(done.attempts,3);assert.equal(calls,1);assert.equal(done.spec.prompt,spec.prompt);assert.equal(store.list().length,1);assert.equal(jobs.get('owner',cancelled).stage,'cancelled');}finally{await jobs.close();store.close();}
});
