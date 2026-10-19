import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,utimesSync,existsSync,statSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {GenerationTraces,safeTrace} from '../src/generation-trace.ts';
import {CloudTransport} from '../src/transport.ts';
import {GenerationEngine} from '../src/live.ts';
import {Store} from '../src/store.ts';
import {GenerationJobs} from '../src/jobs.ts';
import {createApp} from '../src/api.ts';
import {Fault} from '../src/contracts.ts';
import {prepareDocument} from '../src/validation.ts';
import {html,spec} from './helpers.ts';
const route=()=>new CloudTransport({base:'https://ollama.com/v1',key:'synthetic',model:'gemma4:31b'});
const evidence=async()=>({profiles:[320,390,844],offline:true as const,errors:0 as const,scope:'full-html' as const});
const request={spec,mode:'live' as const,providerMode:'ollama-cloud' as const,telegramConsent:false};
async function settled(jobs:GenerationJobs,id:string){for(let i=0;i<200;i++){const j=jobs.get('owner',id);if(['completed','needs_attention'].includes(j.stage))return j;await new Promise(r=>setTimeout(r,10));}throw Error('WAIT');}

test('trace drops unknown fields, raw text, credentials and env secrets; absent metrics remain null',()=>{
 const id=randomUUID(),bad={durationMs:12,actualModel:'private-test-value',requestedModel:'https://user:password@proxy',errorCode:'Bearer private-token',prompt:spec.prompt,html,Authorization:'Bearer credential',outputBytes:NaN};
 const row=safeTrace('response.failed',id,bad,{CLOUD_API_KEY:'private-test-value'}),encoded=JSON.stringify(row);
 assert.equal(row.durationMs,12);assert.equal(row.outputTokens,null);assert.equal(row.outputBytes,null);assert.equal(row.actualModel,null);
 for(const secret of ['private-test-value','password','private-token',spec.prompt,html,'credential','prompt','Authorization'])assert.ok(!encoded.includes(secret));
 assert.throws(()=>safeTrace('untrusted-event',id));
});
test('trace rotates bounded files, expires only owned diagnostic files and survives reopen',()=>{
 const directory=mkdtempSync('.local/trace-test-'),id=randomUUID(),old=randomUUID()+'.jsonl';writeFileSync(directory+'/'+old,'');utimesSync(directory+'/'+old,0,0);writeFileSync(directory+'/user-game.html','preserve');
 const traces=new GenerationTraces(directory);assert.equal(existsSync(directory+'/'+old),false);
 for(let i=0;i<650;i++)traces.emit(id,'response.headers',{attempt:i,httpStatus:200});
 assert.ok(statSync(directory+'/'+id+'.jsonl').size<=131072);assert.ok(statSync(directory+'/'+id+'.jsonl.1').size<=131072);
 assert.equal(readFileSync(directory+'/user-game.html','utf8'),'preserve');const rows=new GenerationTraces(directory).report(id).events;assert.equal(rows.at(-1)!.attempt,649);assert.ok(rows.length>0);
});
test('format fixtures preserve valid and markdown HTML; incomplete, empty and unexplained trailing source are explicit failures',()=>{
 for(const value of [html,'```html\n'+html+'\n```'])assert.equal(prepareDocument(value).html,html.trim());
 for(const value of ['',html.replace('</html>',''),html+' extra explanation','<!doctype html><html>partial'])assert.throws(()=>prepareDocument(value),/LLM_INVALID_HTML/);
});
test('SSE handles split UTF8, CRLF, multiline data, usage, DONE without EOF and emits metadata',async t=>{
 const payload=JSON.stringify({model:'gemma4:31b',choices:[{delta:{content:html+' Бабушка'},finish_reason:'stop'}],usage:{completion_tokens:71}},null,2).split('\n').map(l=>'data: '+l).join('\r\n')+'\r\n\r\ndata: [DONE]\r\n\r\n';
 const bytes=new TextEncoder().encode(payload),events:string[]=[],parts:string[]=[];let offset=0,cancelled=false;
 t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>init?.method!=='POST'?Response.json({data:[{id:'gemma4:31b'}]}):new Response(new ReadableStream({pull(c){if(offset<bytes.length){c.enqueue(bytes.slice(offset,offset+7));offset+=7;}},cancel(){cancelled=true;}})));
 const output=await route().complete([],AbortSignal.timeout(3000),{stage(){},dispatch(){},attempt(){},partial(code){parts.push(code);},trace(e){events.push(e);}});
 assert.equal(output.code,html+' Бабушка');assert.equal(output.outputTokens,71);assert.equal(cancelled,true);assert.equal(parts.at(-1),output.code);
 assert.deepEqual(events,['provider.catalog_completed','request.started','response.headers','response.first_byte','response.stream_completed']);
});
test('malformed stream and interrupted stream preserve partial; body cap and HTTP 429 remain distinct',async t=>{
 let scenario='interrupted',latest='';
 t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{
  if(init?.method!=='POST')return Response.json({data:[{id:'gemma4:31b'}]});
  if(scenario==='rate')return new Response('',{status:429,headers:{'retry-after':'1'}});
  const first='data: '+JSON.stringify({model:'gemma4:31b',choices:[{delta:{content:'<!doctype html><html>partial'},finish_reason:null}]})+'\n\n';
  if(scenario==='large')return new Response('data: '+ 'x'.repeat(1210001));
  return new Response(first+(scenario==='malformed'?'data: {bad}\n\n':''));
 });
 for(const [kind,code]of [['interrupted','LLM_CONNECTION_INTERRUPTED'],['malformed','LLM_INVALID_RESPONSE'],['large','LLM_RESPONSE_BODY_TOO_LARGE'],['rate','LLM_RATE_LIMIT']]){scenario=kind;await assert.rejects(route().complete([],AbortSignal.timeout(3000),{stage(){},dispatch(){},attempt(){},partial(v){if(v)latest=v;}}),new RegExp(code));}
 assert.equal(latest,'<!doctype html><html>partial');
});
test('durable job report is chronological, authorized, source-free and identifies saving',async t=>{
 t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>init?.method!=='POST'?Response.json({data:[{id:'gemma4:31b'}]}):new Response('data: '+JSON.stringify({model:'gemma4:31b',choices:[{delta:{content:html},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'));
 const store=new Store(':memory:'),engine=new GenerationEngine([route()],{check:evidence}),jobs=new GenerationJobs(store,engine),app=createApp(store,engine,undefined,undefined,undefined,undefined,jobs);
 try{const id=jobs.create('owner','diagnostic-end-to-end',request).jobId;assert.equal((await settled(jobs,id)).stage,'completed');
 const response=await app.request('/api/jobs/'+id+'/diagnostics'),report=await response.json();assert.equal(response.status,200);assert.match(response.headers.get('content-disposition')!,/attachment/);
 const names=report.events.map((e:any)=>e.event);for(const name of ['job.created','prompt.prepared','provider.selected','request.started','response.headers','response.first_byte','response.stream_completed','html.extracted','html.validated','browser.started','browser.validation_completed','version.saved','job.completed'])assert.ok(names.includes(name),name);
 assert.equal(names.at(-1),'job.completed');assert.ok(report.events.every((e:any)=>e.correlationId===id));assert.ok(!JSON.stringify(report).includes(spec.prompt));assert.ok(!JSON.stringify(report).includes(html));assert.throws(()=>jobs.report('other',id),/JOB_NOT_FOUND/);
 }finally{await jobs.close();store.close();}
});
test('inconclusive complete safe HTML offers opaque preview; critical error and timeout do not',async()=>{
 for(const code of ['BROWSER_CHECK_INCONCLUSIVE','JAVASCRIPT_EXCEPTION','BROWSER_TIMEOUT']){
 const store=new Store(':memory:'),engine=new GenerationEngine([{provider:'ollama.com',model:'gemma4:31b',route:'primary',readiness:async()=>'ready',complete:async()=>({code:html,model:'gemma4:31b'})}],{repairs:0,check:async()=>{throw new Fault(code);}}),jobs=new GenerationJobs(store,engine),app=createApp(store,engine,undefined,undefined,undefined,undefined,jobs);
 try{const id=jobs.create('owner','preview-'+code,request).jobId;await settled(jobs,id);const response=await app.request('/api/jobs/'+id+'/preview');assert.equal(response.status,code==='BROWSER_CHECK_INCONCLUSIVE'?200:409);if(response.status===200)assert.match(response.headers.get('content-security-policy')!,/^sandbox allow-scripts;/);assert.equal(store.list().length,0);assert.equal(jobs.get('owner',id).checkpoint,html);}finally{await jobs.close();store.close();}
 }
});

test('upgrade preserves an old queued router retry without dispatch; manual Continue alone permits a request',async()=>{
 const store=new Store(':memory:');let jobs=new GenerationJobs(store),calls=0;
 const id=jobs.create('owner','old-queued-router',{...request,providerMode:'openrouter'}).jobId;await settled(jobs,id);await jobs.close();
 store.db.prepare("UPDATE generation_jobs SET status='queued',attempts=1,metadata=json_set(metadata,'$.provider','openrouter','$.automaticRuns',1,'$.errorCode','LLM_RATE_LIMIT','$.deadlineAt',?) WHERE job_id=?").run(Date.now()+60000,id);
 const engine=new GenerationEngine([{provider:'openrouter',model:'openrouter/free',route:'primary',readiness:async()=>'ready',complete:async()=>{calls++;return{code:html,model:'actual-free-model'};}}],{check:evidence});
 jobs=new GenerationJobs(store,engine);
 try{await new Promise(r=>setTimeout(r,30));assert.equal(calls,0);assert.equal(jobs.get('owner',id).stage,'needs_attention');jobs.continue('owner',id);assert.equal((await settled(jobs,id)).stage,'completed');assert.equal(calls,1);}finally{await jobs.close();store.close();}
});

test('diagnostic IO failure cannot strand, cancel-block or duplicate a job; report exposes degraded logging',async t=>{
 t.mock.method(GenerationTraces.prototype,'emit',()=>{throw Error('private credential in an IO exception');});
 const warnings:string[]=[];t.mock.method(console,'warn',(value:string)=>{warnings.push(value);});
 const store=new Store(':memory:'),jobs=new GenerationJobs(store);
 try{const id=jobs.create('owner','diagnostics-io-failure',{...request,mode:'demo'}).jobId;assert.equal((await settled(jobs,id)).stage,'completed');assert.equal(store.list().length,1);assert.equal(jobs.get('owner',id).diagnosticsUnavailable,true);const report=jobs.report('owner',id);assert.equal(report.diagnosticsUnavailable,true);assert.equal(report.state,'completed');assert.equal(JSON.stringify(report).includes('private credential'),false);const cancel=jobs.create('owner','diagnostics-cancel',{...request,mode:'demo'}).jobId;jobs.cancel('owner',cancel);assert.equal(jobs.get('owner',cancel).stage,'cancelled');assert.deepEqual(warnings,['GENERATION_DIAGNOSTICS_UNAVAILABLE']);}finally{await jobs.close();store.close();}
});
test('complete router checkpoint failing revalidation cannot authorize automatic repair after restart',async()=>{
 let calls=0;const engine=new GenerationEngine([{provider:'openrouter',model:'openrouter/free',route:'primary',readiness:async()=>'ready',complete:async()=>{calls++;return{code:html,model:'actual-free'};}}],{allowLlmRepair:true,check:async()=>{throw new Fault('JAVASCRIPT_EXCEPTION');}});
 await assert.rejects(engine.generate(spec,undefined,undefined,undefined,{providerMode:'openrouter',checkpoint:html,checkpointOrigin:{provider:'openrouter',requestedModel:'openrouter/free',model:'actual-free'},stage(){},dispatch(){},partial(){},attempt(){}}),/JAVASCRIPT_EXCEPTION/);assert.equal(calls,0);
});

test('format-invalid router checkpoint ending html cannot auto-dispatch after restart',async()=>{
 let calls=0;const engine=new GenerationEngine([{provider:'openrouter',model:'openrouter/free',route:'primary',readiness:async()=>'ready',complete:async()=>{calls++;return{code:html,model:'actual-free'};}}],{allowLlmRepair:true,check:evidence});
 await assert.rejects(engine.generate(spec,undefined,undefined,undefined,{providerMode:'openrouter',checkpoint:'not-html</html>',checkpointOrigin:{provider:'openrouter',requestedModel:'openrouter/free',model:'actual-free'},stage(){},dispatch(){},partial(){},attempt(){}}),/LLM_INVALID_HTML/);assert.equal(calls,0);
});
