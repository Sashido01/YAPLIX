import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {GenerationEngine} from '../src/live.ts';
import type {CodeTransport,GenerationContext,ProviderMode} from '../src/transport.ts';
import {GenerationJobs} from '../src/jobs.ts';
import {Store} from '../src/store.ts';
import {spec,html} from './helpers.ts';
import {offlineChatGpt,connected,completed,sse} from './chatgpt-helper.ts';
import {ChatGptTransport} from '../src/chatgpt.ts';
import {chatGptRequest,CHATGPT_HTTP_OPTIONS} from '../src/chatgpt-http.ts';
import {Agent,ProxyAgent} from 'undici';

const minute=60000;
const evidence=async()=>({profiles:[320,390,844],offline:true as const,errors:0 as const,scope:'full-html' as const,rendering:{contract:'canvas-webgl-strict-v2' as const,contexts:['2d' as const],profiles:[320,390,844]}});
function context(mode:ProviderMode='chatgpt',durable=true){
 let calls=0;
 return {get calls(){return calls;},value:{...(durable?{durableJob:true as const}:{}),providerMode:mode,dispatch:()=>{calls++;},stage:()=>{},partial:()=>{},attempt:()=>{}} satisfies GenerationContext};
}
function route(provider='chatgpt',delay=20*minute):CodeTransport{return{
 provider,model:provider==='chatgpt'?'gpt-6.1-sol':'synthetic',route:'primary',readiness:async()=>'ready',
 complete:(_messages,signal)=>new Promise((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);reject(Error('cancelled'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve({code:html,model:provider==='chatgpt'?'gpt-6.1-sol':'synthetic'});},delay);
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 })
};}

test('A1.7 ChatGPT waits beyond 60 seconds and leaves browser validation time after minute 29',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let checking=false,finished=false;
 const engine=new GenerationEngine([route('chatgpt',29*minute)],{check:async()=>{checking=true;await new Promise(r=>setTimeout(r,5*minute));return evidence();}});
 const ctx=context();const work=engine.generate(spec,undefined,'llm_code',undefined,ctx.value).then(value=>{finished=true;return value;});
 // Attach rejection immediately so RED does not generate an unhandled rejection.
 const result=work.then(value=>({value}),error=>({error}));
 t.mock.timers.tick(61_000);await setImmediate();assert.equal(finished,false);
 t.mock.timers.tick(29*minute-61_000);await setImmediate();assert.equal(checking,true);
 t.mock.timers.tick(5*minute);await setImmediate();
 const outcome=await result;assert.ok('value' in outcome,JSON.stringify(outcome));assert.equal(ctx.calls,1);
 // No stale inference/engine timer may abort a later successful result.
 t.mock.timers.tick(60*minute);assert.equal(finished,true);
});

for(const [mode,provider] of [['ollama-cloud','ollama.com'],['openrouter','openrouter'],['chatgpt','chatgpt']] as const)
test('A1.7 inference deadline aborts at 30 minutes with one dispatch: '+mode,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const ctx=context(mode);
 const engine=new GenerationEngine([route(provider,31*minute)],{check:evidence});
 let ended=false;const result=engine.generate(spec,undefined,'llm_code',undefined,ctx.value).catch(error=>{ended=true;return error;});
 t.mock.timers.tick(30*minute-1);await setImmediate();assert.equal(ended,false);
 t.mock.timers.tick(1);await setImmediate();assert.equal(ended,true);const error=await result;assert.equal(error.code,'LLM_TIMEOUT');assert.equal(ctx.calls,1);
});

for(const [mode,provider,durable] of [['ollama-cloud','ollama.com',true],['openrouter','openrouter',true],['chatgpt','chatgpt',true]] as const)
test('A1.7 all providers wait 29 minutes: '+mode+' durable='+durable,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const ctx=context(mode,durable);
 const engine=new GenerationEngine([route(provider,29*minute)],{check:evidence,repairs:0});
 const result=engine.generate(spec,undefined,'llm_code',undefined,ctx.value).catch(error=>error);
 t.mock.timers.tick(29*minute);assert.equal((await result).provider,provider);assert.equal(ctx.calls,1);
});

test('A1.7 durable deadline is 35 minutes for every live provider',async()=>{
 const store=new Store(':memory:'),jobs=new GenerationJobs(store,new GenerationEngine([route(),route('ollama.com'),route('openrouter')],{check:evidence}));
 try{
  for(const mode of ['chatgpt','ollama-cloud','openrouter'] as const){
   const before=Date.now(),job=jobs.create('owner','deadline-'+mode,{spec,mode:'live',providerMode:mode,telegramConsent:false});
   const expected=35*minute;
   assert.ok(job.deadlineAt!>=before+expected&&job.deadlineAt!<=Date.now()+expected);
   jobs.cancel('owner',job.jobId);
  }
 }finally{await jobs.close();store.close();}
});

for(const phase of ['headers','silent SSE'] as const)test('A1.7 signed synthetic transport supports long '+phase+' and releases dispatcher',async t=>{
 let posts=0,cancelled=0;let dispatcher:Agent|ProxyAgent|undefined;
 const {session}=offlineChatGpt(async(_url,init)=>{
  posts++;dispatcher=(init as RequestInit&{dispatcher:Agent}).dispatcher;
  if(phase==='headers')await new Promise<void>((resolve,reject)=>{
   const abort=()=>{clearTimeout(timer);reject(Error('aborted'));},timer=setTimeout(()=>{init?.signal?.removeEventListener('abort',abort);resolve();},20*minute);
   init?.signal?.addEventListener('abort',abort,{once:true});
  });
  return phase==='headers'?sse([completed(html)]):new Response(new ReadableStream({start(c){setTimeout(()=>{c.enqueue(Buffer.from('data: '+JSON.stringify(completed(html))+'\n\n'));},20*minute);},cancel(){cancelled++;}}));
 });
 await connected(session);t.mock.timers.enable({apis:['setTimeout']});
 const ctx=context(),engine=new GenerationEngine([new ChatGptTransport(session)],{check:evidence});
 try{
  const work=engine.generate(spec,undefined,'llm_code',undefined,ctx.value);
  await setImmediate();assert.equal(posts,1);assert.ok(dispatcher instanceof Agent||dispatcher instanceof ProxyAgent);
  t.mock.timers.tick(20*minute);assert.equal((await work).provider,'chatgpt');
  assert.equal(Reflect.get(dispatcher,'destroyed'),true);assert.equal(ctx.calls,1);if(phase==='silent SSE')assert.equal(cancelled,1);
  t.mock.timers.tick(60*minute); // Completed stream must have no deadline left.
 }finally{session.disconnect();}
});

for(const reason of ['deadline','manual cancel'] as const)test('A1.7 stalled SSE stops on '+reason+'; spent job cannot resend after restart',async t=>{
 let posts=0,cancelled=0;let dispatcher:Agent|undefined;
 const {session}=offlineChatGpt(async(_url,init)=>{posts++;dispatcher=(init as RequestInit&{dispatcher:Agent}).dispatcher;return new Response(new ReadableStream({cancel(){cancelled++;}}));});
 await connected(session);t.mock.timers.enable({apis:['setTimeout']});
 const store=new Store(':memory:'),engine=new GenerationEngine([new ChatGptTransport(session)],{check:evidence});let jobs=new GenerationJobs(store,engine);
 try{
  const created=jobs.create('owner','stall-'+reason.replace(' ','-'),{spec,mode:'live',providerMode:'chatgpt',telegramConsent:false});await setImmediate();assert.equal(posts,1);
  if(reason==='deadline')t.mock.timers.tick(30*minute);else jobs.cancel('owner',created.jobId);
  await setImmediate();const done=jobs.get('owner',created.jobId);
  assert.equal(done.stage,reason==='deadline'?'needs_attention':'cancelled');assert.equal(done.attempts,1);
  if(reason==='deadline')assert.equal(done.errorCode,'LLM_TIMEOUT');
  assert.equal(cancelled,1);assert.equal(dispatcher?.destroyed,true);
  assert.throws(()=>jobs.continue('owner',done.jobId),/CHATGPT_NEW_JOB_REQUIRED/);
  await jobs.close();jobs=new GenerationJobs(store,engine);await setImmediate();assert.equal(posts,1);assert.equal(jobs.get('owner',done.jobId).attempts,1);
 }finally{session.disconnect();await jobs.close();store.close();}
});

test('A1.7 total engine deadline is finite at 35 minutes including validation',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let validationSignal:AbortSignal|undefined;
 const engine=new GenerationEngine([route('chatgpt',29*minute)],{check:async(_html,signal)=>{
  validationSignal=signal;await new Promise<void>((_yes,no)=>signal!.addEventListener('abort',()=>no(Error('cancelled')),{once:true}));return evidence();
 }});
 const result=engine.generate(spec,undefined,'llm_code',undefined,context().value).catch(error=>error);
 t.mock.timers.tick(29*minute);await setImmediate();assert.equal(validationSignal?.aborted,false);
 t.mock.timers.tick(6*minute);assert.equal((await result).code,'LLM_TIMEOUT');assert.equal(validationSignal?.aborted,true);
});

test('A1.7 HTTP header/body budgets are finite and connection budget stays short',()=>{
 assert.equal(CHATGPT_HTTP_OPTIONS.headersTimeout,30*minute);assert.equal(CHATGPT_HTTP_OPTIONS.bodyTimeout,30*minute);assert.equal(CHATGPT_HTTP_OPTIONS.connect.timeout,10_000);
});

test('A1.7 HTTP own absolute deadline bounds a silent response independently of engine',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let cancelled=0;let signal:AbortSignal|undefined;
 const work=chatGptRequest(async(_url,init)=>{signal=init?.signal??undefined;return new Response(new ReadableStream({cancel(){cancelled++;}}));},'https://api.openai.com/v1/responses',{},async(response,combined)=>{
  const reader=response.body!.getReader();const abort=()=>void reader.cancel();combined.addEventListener('abort',abort,{once:true});
  try{await reader.read();combined.throwIfAborted();}finally{combined.removeEventListener('abort',abort);}
 }).catch(error=>error);
 await setImmediate();t.mock.timers.tick(30*minute-1);assert.equal(signal?.aborted,false);
 t.mock.timers.tick(1);assert.equal((await work).name,'AbortError');assert.equal(cancelled,1);
});

test('A1.7 durable wall-clock deadline cancels at 35 minutes and survives restart',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:Date.now()});
 const store=new Store(':memory:');let calls=0,aborted=false;
 const generator={generate:async(_spec:unknown,_previous:unknown,_method:unknown,signal?:AbortSignal,ctx?:GenerationContext)=>{
  ctx!.dispatch(route());calls++;
  await new Promise<void>((_yes,no)=>signal!.addEventListener('abort',()=>{aborted=true;no(Error('cancelled'));},{once:true}));
  throw Error('unreachable');
 }};
 let jobs=new GenerationJobs(store,generator);
 try{
  const created=jobs.create('owner','wall-clock-deadline',{spec,mode:'live',providerMode:'chatgpt',telegramConsent:false});await setImmediate();
  for(let i=0;i<69;i++){t.mock.timers.tick(30_000);await setImmediate();}
  assert.equal(aborted,false);assert.equal(jobs.get('owner',created.jobId).stage,'generating');
  t.mock.timers.tick(30_000);await setImmediate();
  const done=jobs.get('owner',created.jobId);assert.equal(aborted,true);assert.equal(done.errorCode,'JOB_DURATION_LIMIT');assert.equal(done.attempts,1);
  await jobs.close();jobs=new GenerationJobs(store,generator);await setImmediate();assert.equal(calls,1);assert.equal(jobs.get('owner',done.jobId).deadlineAt,created.deadlineAt);
 }finally{await jobs.close();store.close();}
});
