import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {configuredGenerator,GenerationEngine} from '../src/live.ts';
import {CloudTransport,ProviderFailure} from '../src/transport.ts';
import type {CodeTransport,ProviderMode} from '../src/transport.ts';
import {Store} from '../src/store.ts';
import {GenerationJobs} from '../src/jobs.ts';
import {createApp} from '../src/api.ts';
import {html,spec} from './helpers.ts';
const evidence=async()=>({rendering:{contract:'canvas-webgl-strict-v2' as const,contexts:['2d' as const],profiles:[320,390,844]},profiles:[320,390],offline:true as const,errors:0 as const,scope:'startup-input-pause' as const});
const request={spec,mode:'live' as const,telegramConsent:false};
const route=(provider:string,complete:CodeTransport['complete']):CodeTransport=>({provider,route:provider==='openrouter'?'secondary':'primary',model:provider==='openrouter'?'openrouter/free':'gemma4:31b',readiness:async()=>'ready',complete});
async function settle(jobs:GenerationJobs,id:string){for(let i=0;i<400;i++){const j=jobs.get('owner',id);if(['completed','needs_attention','cancelled'].includes(j.stage))return j;await new Promise(r=>setTimeout(r,5));}throw Error('WAIT_TIMEOUT');}

test('only the two authorized models survive obsolete model, local and secondary configuration',()=>{
 const engine=configuredGenerator({OLLAMA_CLOUD_API_KEY:'synthetic',CLOUD_API_KEY:'synthetic',OLLAMA_CLOUD_MODEL:'old',CLOUD_MODEL:'paid',LLM_LOCAL_FALLBACK:'1',LLM_FALLBACK:'secondary',SECONDARY_BASE_URL:'https://paid.example/v1',SECONDARY_API_KEY:'synthetic',SECONDARY_MODEL:'paid'})!;
 assert.deepEqual(engine.routes.map(r=>[r.provider,r.model]),[['ollama.com','gemma4:31b'],['openrouter','openrouter/free']]);
 for(const model of ['openrouter/auto','vendor/x:free','paid'])assert.throws(()=>new CloudTransport({base:'https://openrouter.ai/api/v1',key:'synthetic',model}),/FREE_MODEL_REQUIRED/);
 assert.throws(()=>new CloudTransport({base:'https://ollama.com/v1',key:'synthetic',model:'other'}),/FREE_MODEL_REQUIRED/);
});

for(const mode of ['auto','ollama-cloud','openrouter'] as ProviderMode[])test(mode+' dispatches only its selected routes (synthetic)',async()=>{
 const calls:string[]=[];const engine=new GenerationEngine([route('ollama.com',async()=>{calls.push('ollama');throw new ProviderFailure('LLM_AUTH');}),route('openrouter',async()=>{calls.push('openrouter');return{code:html,model:'upstream-free'};})],{check:evidence});
 const store=new Store(':memory:'),jobs=new GenerationJobs(store,engine);
 try{const job=await settle(jobs,jobs.create('owner','mode-'+mode,{...request,providerMode:mode}).jobId);assert.deepEqual(calls,mode==='openrouter'?['openrouter']:['ollama']);assert.equal(job.stage,mode==='openrouter'?'completed':'needs_attention');assert.equal(job.providerMode,mode);}finally{await jobs.close();store.close();}
});

test('an explicitly selected router never calls Ollama after worker/engine restart; only manual Continue repeats, Retry-After and budget survive',async t=>{
 let time=Date.now(),primary=0,secondary=0;t.mock.method(Date,'now',()=>time);
 const make=()=>new GenerationEngine([route('ollama.com',async()=>{primary++;throw new ProviderFailure('LLM_CONNECTION_INTERRUPTED');}),route('openrouter',async()=>{secondary++;throw new ProviderFailure('LLM_RATE_LIMIT',null,'',{},time+60000,429);})],{check:evidence});
 const store=new Store(':memory:');let jobs=new GenerationJobs(store,make());const id=jobs.create('owner','durable-switch',{...request,providerMode:'openrouter'}).jobId;
 try{for(let i=0;i<100&&jobs.get('owner',id).attempts<1;i++)await new Promise(r=>setTimeout(r,5));await jobs.close();const before=jobs.get('owner',id);assert.ok(before.provider==='openrouter');assert.equal(before.attempts,1);
  time+=60001;jobs=new GenerationJobs(store,make());await new Promise(r=>setTimeout(r,50));const after=jobs.get('owner',id);assert.equal(primary,0);assert.equal(secondary,1);assert.equal(after.stage,'needs_attention');assert.equal(after.deadlineAt,before.deadlineAt);assert.equal(after.automaticLimit,before.automaticLimit);assert.equal(after.spec.prompt,spec.prompt);jobs.continue('owner',id);await settle(jobs,id);assert.equal(secondary,2);assert.equal(primary,0);assert.ok(jobs.get('owner',id).retryAt!>time);
 }finally{await jobs.close();store.close();}
});

test('authorization and exhausted quota are not retried without a job context',async()=>{
 for(const code of ['LLM_AUTH','LLM_QUOTA']){let calls=0;const engine=new GenerationEngine([route('ollama.com',async()=>{calls++;throw new ProviderFailure(code);})],{check:evidence,repairs:2});await assert.rejects(engine.generate(spec),new RegExp(code));await assert.rejects(engine.generate(spec),new RegExp(code));assert.equal(calls,1);}
});

test('legacy demo jobs are preserved but never dispatched or accepted again',async()=>{
 const store=new Store(':memory:');let calls=0;const engine=new GenerationEngine([route('ollama.com',async()=>{calls++;return{code:html,model:'gemma4:31b'};})],{check:evidence});
 const id=randomUUID(),createdAt=new Date().toISOString(),legacy={spec,mode:'demo',providerMode:'auto',telegramConsent:false},metadata={...legacy,provider:null,requestedModel:null,automaticLimit:1,repairBudget:0,deadlineAt:Date.now()+60000};
 store.db.prepare('INSERT INTO generation_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,0)').run(id,'owner','legacy-demo',JSON.stringify(legacy),'queued',0,'',JSON.stringify(metadata),createdAt,createdAt,null);
 const app=createApp(store,engine);let jobs:GenerationJobs|undefined;
 try{const response=await app.request('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,mode:'demo',idempotencyKey:'legacy-demo'})});assert.equal(response.status,400);assert.equal((await response.json()).error,'INVALID_MODE');jobs=new GenerationJobs(store,engine);const stopped=await settle(jobs,id);assert.equal(stopped.stage,'needs_attention');assert.equal(stopped.errorCode,'LEGACY_DEMO_DISABLED');assert.equal(calls,0);assert.equal(store.db.prepare('SELECT count(*) n FROM generation_jobs').get()?.n,1);}finally{await jobs?.close();engine.close();store.close();}
});

test('removing an interrupted explicit provider does not prevent startup or delete its job',async()=>{
 const store=new Store(':memory:');let jobs=new GenerationJobs(store);const old=jobs.create('owner','missing-route',{...request,providerMode:'ollama-cloud'});await settle(jobs,old.jobId);await jobs.close();store.db.prepare("UPDATE generation_jobs SET status='generating' WHERE job_id=?").run(old.jobId);
 const engine=new GenerationEngine([route('openrouter',async()=>({code:html,model:'upstream'}))],{check:evidence});jobs=new GenerationJobs(store,engine);
 try{assert.equal(jobs.get('owner',old.jobId).stage,'needs_attention');const resumed=jobs.create('owner','still-works',{...request,providerMode:'openrouter'});assert.equal((await settle(jobs,resumed.jobId)).stage,'completed');assert.equal(jobs.list('owner').length,2);}finally{await jobs.close();store.close();}
});

test('manual Continue keeps the explicitly selected router',async()=>{
 const calls:string[]=[];let ready=false;
 const engine=new GenerationEngine([route('ollama.com',async()=>{calls.push('ollama');throw new ProviderFailure('LLM_AUTH');}),route('openrouter',async()=>{calls.push('openrouter');return{code:ready?html:'invalid',model:'upstream'};})],{repairs:0,check:evidence});
 const store=new Store(':memory:'),jobs=new GenerationJobs(store,engine);
 try{const id=jobs.create('owner','continue-switch',{...request,providerMode:'openrouter'}).jobId;await settle(jobs,id);ready=true;jobs.continue('owner',id);assert.equal((await settle(jobs,id)).stage,'completed');assert.deepEqual(calls,['openrouter','openrouter']);}finally{await jobs.close();store.close();}
});

test('streamed daily quota is terminal for jobs and catalogue quota prevents an inference POST',async t=>{
 let posts=0,catalogQuota=false;t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{if(init?.method==='POST'){posts++;return new Response('data: '+JSON.stringify({error:{code:429,message:'Daily free-models-per-day limit exhausted'}})+'\n\n');}return catalogQuota?new Response('quota exhausted',{status:402}):Response.json({data:[]});});
 const cloud=new CloudTransport({base:'https://openrouter.ai/api/v1',key:'synthetic',model:'openrouter/free'}),store=new Store(':memory:'),jobs=new GenerationJobs(store,new GenerationEngine([cloud],{check:evidence}));
 try{const job=await settle(jobs,jobs.create('owner','sse-quota',{...request,providerMode:'openrouter'}).jobId);assert.equal(job.errorCode,'LLM_QUOTA');assert.equal(posts,1);assert.equal(job.stage,'needs_attention');catalogQuota=true;await assert.rejects(cloud.complete([],AbortSignal.timeout(2000),{stage(){},dispatch(){},partial(){},attempt(){}}),/LLM_QUOTA/);assert.equal(posts,1);}finally{await jobs.close();store.close();}
});

test('missing legacy mode is durably Auto across different server defaults; completed replay needs no provider',async()=>{
 const store=new Store(':memory:'),calls:string[]=[];
 const primary=route('ollama.com',async()=>{calls.push('ollama');return{code:html,model:'gemma4:31b'};}),secondary=route('openrouter',async()=>{calls.push('openrouter');return{code:html,model:'upstream'};});
 let jobs=new GenerationJobs(store,new GenerationEngine([primary,secondary],{defaultMode:'ollama-cloud',check:evidence}));
 try{const made=jobs.create('owner','auto-canonical',request);const done=await settle(jobs,made.jobId);assert.equal(done.stage,'completed');assert.equal(done.providerMode,'auto');assert.deepEqual(calls,['ollama']);await jobs.close();
  const row=store.db.prepare('SELECT request,metadata FROM generation_jobs WHERE job_id=?').get(done.jobId)!;const legacyRequest=JSON.parse(String(row.request)),metadata=JSON.parse(String(row.metadata));delete legacyRequest.providerMode;delete metadata.providerMode;store.db.prepare('UPDATE generation_jobs SET request=?,metadata=? WHERE job_id=?').run(JSON.stringify(legacyRequest),JSON.stringify(metadata),done.jobId);
  jobs=new GenerationJobs(store,new GenerationEngine([primary],{defaultMode:'ollama-cloud',check:evidence}));assert.equal(jobs.create('owner','auto-canonical',{...request,providerMode:'auto'}).jobId,done.jobId);assert.equal(jobs.get('owner',done.jobId).providerMode,'auto');
  const explicit=jobs.create('owner','explicit-replay',{...request,providerMode:'ollama-cloud'});await settle(jobs,explicit.jobId);await jobs.close();jobs=new GenerationJobs(store,new GenerationEngine([secondary],{check:evidence}));assert.equal(jobs.create('owner','explicit-replay',{...request,providerMode:'ollama-cloud'}).jobId,explicit.jobId);
 }finally{await jobs.close();store.close();}
});

test('a pre-dispatch primary refusal cannot select the router',async()=>{
 const store=new Store(':memory:');const engine=new GenerationEngine([{...route('ollama.com',async()=>{throw new ProviderFailure('LLM_AUTH');}),observesDispatch:true},route('openrouter',async()=>({code:'invalid',model:'upstream'}))],{repairs:0,check:evidence}),jobs=new GenerationJobs(store,engine);
 try{const done=await settle(jobs,jobs.create('owner','catalog-fallback',request).jobId);assert.equal(done.attempts,0);assert.equal(done.provider,'ollama.com');assert.equal(done.retiredRoutes?.length??0,0);}finally{await jobs.close();store.close();}
});

test('Ollama Cloud rejects an upstream model substitution before accepting its output',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({model:'other-model',choices:[{finish_reason:'stop',message:{content:html}}]}));
 const cloud=new CloudTransport({base:'https://ollama.com/v1',key:'synthetic',model:'gemma4:31b'});await assert.rejects(cloud.complete([],AbortSignal.timeout(2000)),/LLM_INVALID_RESPONSE/);
});

test('diagnostics honor the server explicit mode and report unavailable configuration safely',async()=>{
 const calls:string[]=[];const primary={...route('ollama.com',async()=>({code:html,model:'gemma4:31b'})),readiness:async()=>{calls.push('ollama');return'ready';}},secondary={...route('openrouter',async()=>({code:html,model:'upstream'})),readiness:async()=>{calls.push('openrouter');return'ready';}};
 const ready=await new GenerationEngine([primary,secondary],{defaultMode:'openrouter',check:evidence}).readiness();assert.equal(ready.provider,'openrouter');assert.equal(ready.fallbackConfigured,false);assert.deepEqual(calls,['openrouter']);
 assert.equal((await new GenerationEngine([primary],{defaultMode:'openrouter',check:evidence}).readiness()).llmState,'not_configured');
});

test('backend rejects arbitrary UI routes and unavailable explicit provider before enqueue',async()=>{
 const store=new Store(':memory:'),engine=new GenerationEngine([route('ollama.com',async()=>({code:html,model:'gemma4:31b'}))],{check:evidence}),jobs=new GenerationJobs(store,engine),app=createApp(store,engine,undefined,undefined,undefined,undefined,jobs);
 try{for(const mode of ['paid','openrouter/auto','openrouter']){const response=await app.request('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,providerMode:mode,idempotencyKey:'invalid-'+mode})});assert.equal(response.status,mode==='openrouter'?503:400);}assert.equal(jobs.list('owner').length,0);}finally{await jobs.close();store.close();}
});

test('a 429 daily-quota refusal stays terminal; numeric/date Retry-After are honored',async t=>{
 let scenario='quota';t.mock.method(globalThis,'fetch',async()=>new Response(scenario==='quota'?'Daily free-models-per-day limit exhausted':'slow down',{status:429,headers:{'Retry-After':scenario==='date'?new Date(Date.now()+90000).toUTCString():'60'}}));
 const transport=new CloudTransport({base:'https://openrouter.ai/api/v1',key:'synthetic',model:'openrouter/free'});
 for(scenario of ['quota','rate','date'])await assert.rejects(transport.complete([],AbortSignal.timeout(2000)),e=>e instanceof ProviderFailure&&e.code===(scenario==='quota'?'LLM_QUOTA':'LLM_RATE_LIMIT')&&e.retryAt!>Date.now()+58000);
});
