import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.ts';
import {GenerationJobs} from '../src/jobs.ts';
import {GenerationEngine} from '../src/live.ts';
import {CloudTransport,ProviderFailure} from '../src/transport.ts';
import type {CodeTransport} from '../src/transport.ts';
import type {GenerationJob} from '../src/job-contracts.ts';
import {html,spec} from './helpers.ts';

const evidence=async()=>({rendering:{contract:'canvas-webgl-strict-v2' as const,contexts:['2d' as const],profiles:[320,390,844]},profiles:[320,390],offline:true as const,errors:0 as const,scope:'startup-input-pause' as const});
const request={spec,mode:'live' as const,telegramConsent:false};
const route=(complete:CodeTransport['complete'],provider='synthetic-free',name:CodeTransport['route']='primary'):CodeTransport=>({route:name,provider,model:provider+'-requested',complete,readiness:async()=>'ready'});
const pause=(ms=5)=>new Promise<void>(done=>setTimeout(done,ms));
async function waitFor(jobs:GenerationJobs,id:string,predicate:(job:GenerationJob)=>boolean){for(let i=0;i<400;i++){const job=jobs.get('owner',id);if(predicate(job))return job;await pause();}throw Error('JOB_WAIT_TIMEOUT');}
const terminal=(job:GenerationJob)=>['completed','needs_attention','cancelled','failed'].includes(job.stage);
function metadata(store:Store,id:string,update:Record<string,unknown>,status?:string,checkpoint?:string){const row=store.db.prepare('SELECT metadata FROM generation_jobs WHERE job_id=?').get(id)!;store.db.prepare('UPDATE generation_jobs SET metadata=?,status=COALESCE(?,status),checkpoint=COALESCE(?,checkpoint) WHERE job_id=?').run(JSON.stringify({...JSON.parse(String(row.metadata)),...update}),status??null,checkpoint??null,id);}

test('a zero-byte secondary failure cannot relabel the inherited checkpoint or its recovered artifact',async()=>{
 const store=new Store(':memory:');let a=0,b=0;
 const primary=route(async()=>{a++;throw new ProviderFailure('LLM_HTTP','primary-actual',html);});
 const secondary=route(async()=>{b++;throw new ProviderFailure('LLM_QUOTA','secondary-actual','');},'secondary-provider','secondary');
 let jobs=new GenerationJobs(store,new GenerationEngine([primary,secondary],{repairs:0,check:evidence}));
 const id=jobs.create('owner','origin-checkpoint',request).jobId;
 try{
  const draft=await waitFor(jobs,id,terminal);assert.equal(draft.stage,'needs_attention');assert.equal(draft.checkpoint,html);
  assert.deepEqual(draft.checkpointOrigin,{provider:'synthetic-free',requestedModel:primary.model,model:'primary-actual'});
  assert.equal(draft.history.at(-1)?.model,'secondary-actual');assert.equal(a,1);assert.equal(b,1);
  await jobs.close();metadata(store,id,{retryAt:null},'validating');
  jobs=new GenerationJobs(store,new GenerationEngine([primary,secondary],{check:evidence}),undefined,true,{retryMs:10});
  const done=await waitFor(jobs,id,terminal);assert.equal(done.stage,'completed');assert.equal(done.actualModel,'primary-actual');
  const artifact=store.getVersion(done.versionId!);assert.equal(artifact.provider,'synthetic-free');assert.equal(artifact.model,'primary-actual');assert.equal(a,1);assert.equal(b,1);assert.equal(store.list().length,1);
 }finally{await jobs.close();store.close();}
});

// MICRO-019 strengthens the old catalog/price policy: concrete IDs are now
// prohibited even when the catalog explicitly advertises zero token prices.
for(const field of ['prompt','completion'])for(const price of [null,'',false,' ',undefined,'0e0','0.01',-1,0,'0.000'])test('concrete free model is refused regardless of '+field+' pricing '+String(price),t=>{
 let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;return Response.json({data:[{id:'authored/model:free',pricing:{prompt:'0',completion:'0',[field]:price}}]});});
 assert.throws(()=>new CloudTransport({base:'https://openrouter.ai/api/v1',key:'synthetic-key',model:'authored/model:free'}),/FREE_MODEL_REQUIRED/);assert.equal(requests,0);
});

test('superseded concrete OpenRouter models are blocked before any HTTP request',t=>{
 let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;throw Error('MUST_NOT_DISPATCH');});
 for(const model of ['authored/model:free','openrouter/auto','paid-model'])assert.throws(()=>new CloudTransport({base:'https://openrouter.ai/api/v1',key:'synthetic-key',model}),/FREE_MODEL_REQUIRED/);
 assert.equal(requests,0);
});

test('provider Retry-After survives a fresh engine and worker and protects another job',async t=>{
 const store=new Store(':memory:');let now=Date.now();t.mock.method(Date,'now',()=>now);const until=now+60000;let calls=0,ready=false;
 const makeEngine=()=>new GenerationEngine([route(async()=>{calls++;if(!ready)throw new ProviderFailure('LLM_RATE_LIMIT',null,'',{},until,429);return{code:html,model:'actual'};})],{check:evidence});
 let jobs=new GenerationJobs(store,makeEngine(),undefined,true,{retryMs:10});
 const first=jobs.create('owner','durable-provider-a',request).jobId;
 try{
  const waiting=await waitFor(jobs,first,j=>j.stage==='queued'&&Boolean(j.retryAt));assert.equal(waiting.retryAt,until);assert.equal(calls,1);await jobs.close();
  jobs=new GenerationJobs(store,makeEngine(),undefined,true,{retryMs:10});const second=jobs.create('owner','durable-provider-b',request).jobId;
  const other=await waitFor(jobs,second,j=>j.stage==='queued'&&Boolean(j.retryAt));assert.equal(other.retryAt,until);assert.equal(other.attempts,0);assert.equal(calls,1);
  await jobs.close();now=until+1;ready=true;jobs=new GenerationJobs(store,makeEngine(),undefined,true,{retryMs:10});
  assert.equal((await waitFor(jobs,first,terminal)).stage,'completed');assert.equal((await waitFor(jobs,second,terminal)).stage,'completed');assert.equal(calls,3);assert.equal(store.list().length,2);
 }finally{await jobs.close();store.close();}
});

test('a queued deadline ends the job before a later provider Retry-After',async()=>{
 const store=new Store(':memory:');let calls=0;
 const engine=new GenerationEngine([route(async()=>{calls++;throw new ProviderFailure('LLM_RATE_LIMIT',null,'',{},Date.now()+60000,429);})],{check:evidence});
 let jobs=new GenerationJobs(store,engine,undefined,true,{retryMs:10});const id=jobs.create('owner','deadline-before-retry',request).jobId;
 try{await waitFor(jobs,id,j=>j.stage==='queued'&&Boolean(j.retryAt));await jobs.close();metadata(store,id,{deadlineAt:Date.now()+40});jobs=new GenerationJobs(store,new GenerationEngine(engine.routes,{check:evidence}),undefined,true,{retryMs:10});
  const result=await waitFor(jobs,id,terminal);assert.equal(result.stage,'needs_attention');assert.equal(result.errorCode,'JOB_DURATION_LIMIT');assert.equal(calls,1);assert.equal(store.list().length,0);
 }finally{await jobs.close();store.close();}
});

test('cancelled recovered-checkpoint browser validation cannot save a late successful result',async()=>{
 const store=new Store(':memory:');let jobs=new GenerationJobs(store);const id=jobs.create('owner','late-checkpoint-check',request).jobId;let release!:()=>void;const held=new Promise<void>(done=>release=done);let validating=false,calls=0;
 try{await waitFor(jobs,id,terminal);await jobs.close();metadata(store,id,{deadlineAt:Date.now()+60000,automaticLimit:6,checkpointOrigin:{provider:'synthetic-free',requestedModel:'synthetic-free-requested',model:'checkpoint-actual'}},'validating',html);
  jobs=new GenerationJobs(store,new GenerationEngine([route(async()=>{calls++;return{code:html,model:'fresh'};})],{check:async()=>{validating=true;await held;return evidence();}}),undefined,true,{retryMs:10});
  for(let i=0;i<400&&!validating;i++)await pause();assert.equal(validating,true);jobs.cancel('owner',id);release();await jobs.close();
  assert.equal(jobs.get('owner',id).stage,'cancelled');assert.equal(jobs.get('owner',id).versionId,null);assert.equal(calls,0);assert.equal(store.list().length,0);
 }finally{release();await jobs.close();store.close();}
});

test('durable call budget stops repeated refusals and an idempotent result creates one version',async()=>{
 const store=new Store(':memory:');let calls=0;const primary=route(async()=>{calls++;throw new ProviderFailure('LLM_RATE_LIMIT',null,'',{},Date.now()+15,429);});
 let jobs=new GenerationJobs(store,new GenerationEngine([primary],{check:evidence}),undefined,true,{maxCalls:2,retryMs:10});const id=jobs.create('owner','bounded-dispatch',request).jobId;
 try{const result=await waitFor(jobs,id,terminal);assert.equal(result.errorCode,'LLM_RATE_LIMIT');assert.equal(result.attempts,2);assert.equal(calls,2);await jobs.close();
  jobs=new GenerationJobs(store,new GenerationEngine([route(async()=>({code:html,model:'actual'}))],{check:evidence}));const created=jobs.create('owner','one-version-only',request);const done=await waitFor(jobs,created.jobId,terminal);assert.equal(done.stage,'completed');assert.equal(jobs.create('owner','one-version-only',request).jobId,done.jobId);await jobs.close();
  jobs=new GenerationJobs(store,new GenerationEngine([route(async()=>{throw Error('NO_REPEAT');})],{check:evidence}));await pause(20);assert.equal(store.list().length,1);assert.equal(jobs.get('owner',done.jobId).versionId,done.versionId);
 }finally{await jobs.close();store.close();}
});

test('a recovered checkpoint finishing browser validation after its durable deadline creates no version',async()=>{
 const store=new Store(':memory:');let jobs=new GenerationJobs(store);const id=jobs.create('owner','late-deadline-check',request).jobId;let release!:()=>void;const held=new Promise<void>(done=>release=done);let checkSignal:AbortSignal|undefined,calls=0;
 try{await waitFor(jobs,id,terminal);await jobs.close();metadata(store,id,{deadlineAt:Date.now()+120,automaticLimit:6,checkpointOrigin:{provider:'synthetic-free',requestedModel:'synthetic-free-requested',model:'checkpoint-actual'}},'validating',html);
  jobs=new GenerationJobs(store,new GenerationEngine([route(async()=>{calls++;return{code:html,model:'fresh'};})],{check:async(_html,signal)=>{checkSignal=signal;await held;return evidence();}}),undefined,true,{retryMs:10});
  for(let i=0;i<400&&!checkSignal?.aborted;i++)await pause();assert.equal(checkSignal?.aborted,true);release();const result=await waitFor(jobs,id,terminal);assert.equal(result.stage,'needs_attention');assert.equal(result.errorCode,'JOB_DURATION_LIMIT');assert.equal(result.versionId,null);assert.equal(calls,0);assert.equal(store.list().length,0);
 }finally{release();await jobs.close();store.close();}
});

test('the fourth durable create POST ends the job even when more repair passes are configured',async()=>{
 const store=new Store(':memory:');let jobs=new GenerationJobs(store);const id=jobs.create('owner','last-call-repair-budget',request).jobId;let calls=0;
 try{await waitFor(jobs,id,terminal);await jobs.close();metadata(store,id,{deadlineAt:Date.now()+60000,automaticLimit:4},'queued');store.db.prepare('UPDATE generation_jobs SET attempts=3 WHERE job_id=?').run(id);
  jobs=new GenerationJobs(store,new GenerationEngine([route(async()=>{calls++;return{code:'<!doctype html><html><body>incomplete',model:'actual'};})],{repairs:2,check:evidence}));
  const result=await waitFor(jobs,id,terminal);assert.equal(result.errorCode,'LLM_INVALID_HTML');assert.equal(result.attempts,4);assert.equal(calls,1);assert.throws(()=>jobs.continue('owner',id),/JOB_ATTEMPT_LIMIT/);assert.equal(store.list().length,0);
 }finally{await jobs.close();store.close();}
});
