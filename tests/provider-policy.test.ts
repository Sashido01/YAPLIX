import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {setImmediate} from 'node:timers/promises';
import {providerConfiguration} from '../src/provider-configuration.ts';
import {generationTimeouts} from '../src/generation-timeouts.ts';
import {configuredGenerator,GenerationEngine} from '../src/live.ts';
import type {CodeTransport} from '../src/transport.ts';
import {Fault} from '../src/contracts.ts';
import {networkRequest} from '../src/llm-network.ts';
import {createApp} from '../src/api.ts';
import {Store} from '../src/store.ts';
import {GenerationJobs} from '../src/jobs.ts';
import {artifact,spec} from './helpers.ts';

test('effective empty/whitespace/absent keys are configuration refusals, with zero HTTP',async t=>{
 let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;throw Error('NO_HTTP');});
 for(const value of [undefined,'','  ']){
  const env={OLLAMA_CLOUD_API_KEY:value,CLOUD_API_KEY:value};
  assert.equal(configuredGenerator(env),undefined);
  for(const p of providerConfiguration(env)){assert.equal(p.configured,false);assert.equal(p.state,'not_configured');assert.equal(p.configuration,value===undefined?'absent':value===''?'empty':'empty');}
 }
 const engine=configuredGenerator({CLOUD_API_KEY:'synthetic-router'})!;
 assert.throws(()=>engine.routesFor('auto'),/LLM_NOT_CONFIGURED/);
  const readiness=await engine.readiness();assert.equal(readiness.liveConfigured,false);assert.equal(readiness.llmState,'not_configured');
 assert.equal(engine.routesFor('openrouter')[0].provider,'openrouter');
 assert.equal(requests,0);
});

test('Node env-file honors inherited empty keys rather than restoring a file key',()=>{
 const dir=mkdtempSync('.local/a17-env-');
 try{
  writeFileSync(dir+'/synthetic.env','OLLAMA_CLOUD_API_KEY=synthetic-ollama\nCLOUD_API_KEY=synthetic-router\n');
  const result=spawnSync(process.execPath,['--env-file='+dir+'/synthetic.env','-e',"console.log(JSON.stringify({ollama:process.env.OLLAMA_CLOUD_API_KEY==='',router:process.env.CLOUD_API_KEY===''}))"],{encoding:'utf8',env:{...process.env,OLLAMA_CLOUD_API_KEY:'',CLOUD_API_KEY:''}});
  assert.equal(result.status,0);assert.deepEqual(JSON.parse(result.stdout),{ollama:true,router:true});
 }finally{rmSync(dir,{recursive:true});}
});

test('configuration produces three independent pinned routes, including explicit ChatGPT default',()=>{
 const personal:CodeTransport={provider:'chatgpt',model:'gpt-6.1-sol',route:'primary',readiness:async()=>'auth_required',complete:async()=>{throw Error('NO_POST');}};
 const engine=configuredGenerator({OLLAMA_CLOUD_API_KEY:'synthetic-o',CLOUD_API_KEY:'synthetic-r',LIVE_PROVIDER:'chatgpt'},personal)!;
 for(const [mode,provider,model] of [['auto','ollama.com','gemma4:31b'],['ollama-cloud','ollama.com','gemma4:31b'],['openrouter','openrouter','openrouter/free'],['chatgpt','chatgpt','gpt-6.1-sol']] as const){const routes=engine.routesFor(mode);assert.equal(routes.length,1);assert.equal(routes[0].provider,provider);assert.equal(routes[0].model,model);}
 assert.equal(engine.routesFor()[0].provider,'chatgpt');
 assert.deepEqual(engine.timeouts,{responseMs:1800000,jobMs:2100000});
 assert.equal(configuredGenerator({OLLAMA_CLOUD_API_KEY:'',CLOUD_API_KEY:'synthetic'},personal)!.routes.length,2);
});

test('single timeout policy validates finite caps, shared settings and legacy alias',()=>{
 assert.deepEqual(generationTimeouts(),{responseMs:1800000,jobMs:2100000});
 const env={LLM_REQUEST_TIMEOUT_MS:'1200000',LLM_MAX_DURATION_MS:'1800000',LLM_TIMEOUT_MS:'1000'};
 assert.deepEqual(configuredGenerator({...env,OLLAMA_CLOUD_API_KEY:'synthetic'})!.timeouts,{responseMs:1200000,jobMs:1800000});
 assert.deepEqual(generationTimeouts({LLM_TIMEOUT_MS:'2000'}),{responseMs:2000,jobMs:2000});
 for(const env of [{LLM_REQUEST_TIMEOUT_MS:'1800001'},{LLM_MAX_DURATION_MS:'2100001'},{LLM_REQUEST_TIMEOUT_MS:'NaN'},{LLM_MAX_DURATION_MS:'Infinity'},{LLM_REQUEST_TIMEOUT_MS:'1.5'},{LLM_REQUEST_TIMEOUT_MS:''},{LLM_REQUEST_TIMEOUT_MS:'2000',LLM_MAX_DURATION_MS:'1000'}])assert.throws(()=>generationTimeouts(env),/INVALID_LLM_CONFIGURATION/);
});

test('provider status endpoint uses local routes without network or readiness claims',async t=>{
 let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;throw Error('NO_HTTP');});
 const store=new Store(':memory:');
 try{
  const engine=configuredGenerator({CLOUD_API_KEY:'synthetic'})!;
  const response=await createApp(store,engine).request('/api/providers'),data=await response.json();
  assert.equal(response.status,200);assert.deepEqual(data.providers.map((p:{state:string})=>p.state),['not_configured','needs_verification','not_configured']);
  assert.deepEqual(data.timeouts,{responseMs:1800000,jobMs:2100000});assert.equal(requests,0);assert.ok(!JSON.stringify(data).includes('synthetic'));
 }finally{store.close();}
});

for(const provider of ['ollama.com','openrouter'])for(const phase of ['headers','body'])test('cloud HTTP '+provider+' '+phase+' remains open at minute 29 and aborts at 30',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let signal:AbortSignal|undefined;let closed=false;
 const stalled=async()=>{await new Promise<void>((_yes,no)=>signal!.addEventListener('abort',()=>{closed=true;no(signal!.reason);},{once:true}));};
 t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{signal=init.signal!;if(phase==='headers')await stalled();return new Response('synthetic');});
 const result=networkRequest(new URL('https://example.invalid/v1/chat/completions'),{},provider,async()=>{await stalled();},{YAPLIX_LLM_NETWORK:'direct'}).catch(error=>error);
 await setImmediate();t.mock.timers.tick(29*60000);await setImmediate();assert.equal(signal?.aborted,false);assert.equal(closed,false);
 t.mock.timers.tick(60000);await setImmediate();assert.equal(closed,true);assert.equal((await result).code,'LLM_RESPONSE_TIMEOUT');
});

test('SQLite completion rolls back if its write crosses the durable deadline',async t=>{
 const store=new Store(':memory:'),jobs=new GenerationJobs(store);let time=Date.now();
 try{
  const job=jobs.create('owner','sqlite-deadline',{spec,mode:'demo',providerMode:'auto',telegramConsent:false});
  await setImmediate();await jobs.close();
  const deadline=time+1000;t.mock.method(Date,'now',()=>time);
  store.db.prepare("UPDATE generation_jobs SET status='validating',metadata=json_set(metadata,'$.deadlineAt',?) WHERE job_id=?").run(deadline,job.jobId);
  const count=store.list().length,prepare=store.db.prepare.bind(store.db);
  t.mock.method(store.db,'prepare',((sql:string)=>{
   const statement=prepare(sql);
   if(sql.startsWith('INSERT INTO versions')){const run=statement.run.bind(statement);t.mock.method(statement,'run',(...args:Parameters<typeof run>)=>{const value=run(...args);time=deadline;return value;});}
   return statement;
  }) as typeof store.db.prepare);
  assert.throws(()=>store.saveAndCompleteJob(job.jobId,'owner',spec,artifact),/JOB_DURATION_LIMIT/);
  assert.equal(store.list().length,count);assert.equal(jobs.get('owner',job.jobId).stage,'validating');
 }finally{await jobs.close();store.close();}
});

for(const [mode,provider] of [['ollama-cloud','ollama.com'],['openrouter','openrouter']] as const)test('LIVE '+mode+' restart and Continue preserve the original deadline',async t=>{
 let time=Date.now();t.mock.method(Date,'now',()=>time);
 const store=new Store(':memory:'),engine=new GenerationEngine([{provider,model:'synthetic',route:'primary',readiness:async()=>'ready',complete:async()=>{throw new Fault('LLM_AUTH');}}]);
 let jobs=new GenerationJobs(store,engine);
 try{
  const created=jobs.create('owner','keep-deadline-'+mode,{spec,mode:'live',providerMode:mode,telegramConsent:false});await setImmediate();
  assert.equal(jobs.get('owner',created.jobId).stage,'needs_attention');
  time+=1000;jobs.continue('owner',created.jobId);await setImmediate();assert.equal(jobs.get('owner',created.jobId).deadlineAt,created.deadlineAt);
  await jobs.close();jobs=new GenerationJobs(store,engine);assert.equal(jobs.get('owner',created.jobId).deadlineAt,created.deadlineAt);
  // Keep the worker lease live while moving only this test job's deadline.
  store.db.prepare("UPDATE generation_jobs SET metadata=json_set(metadata,'$.deadlineAt',?) WHERE job_id=?").run(time,created.jobId);
  assert.throws(()=>jobs.continue('owner',created.jobId),/JOB_DURATION_LIMIT/);
 }finally{await jobs.close();store.close();}
});
