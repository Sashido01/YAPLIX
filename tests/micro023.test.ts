import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GenerationEngine,configuredGenerator} from '../src/live.ts';
import {CloudTransport,ProviderFailure} from '../src/transport.ts';
import type {CodeTransport,Message} from '../src/transport.ts';
import {generationMessages,extractDocument,GAME_GENERATION_CONTRACT,validateDocument} from '../src/generation.ts';
import {Store} from '../src/store.ts';
import {GenerationJobs} from '../src/jobs.ts';
import {html,spec} from './helpers.ts';
const evidence=async()=>({profiles:[320,390,844],offline:true as const,errors:0 as const,scope:'full-html' as const});
const source=(provider:string,complete:CodeTransport['complete']):CodeTransport=>({provider,model:provider==='ollama.com'?'gemma4:31b':'openrouter/free',route:'primary',readiness:async()=>'ready',complete});
async function settled(jobs:GenerationJobs,id:string){for(let i=0;i<200;i++){const job=jobs.get('owner',id);if(['completed','needs_attention'].includes(job.stage))return job;await new Promise(r=>setTimeout(r,10));}throw Error('JOB_WAIT');}

test('full HTML core has no genre classification, engine preference or mandatory telemetry',()=>{
  for(const prompt of ['Collect rubbish in a house with enemies','Match-3','Snake']){
    const messages=generationMessages({...spec,prompt});assert.equal(messages.length,2);assert.equal(messages[0].content,GAME_GENERATION_CONTRACT);assert.ok(messages[1].content.includes(prompt));
  }
  assert.doesNotMatch(GAME_GENERATION_CONTRACT,/400 lines|Canvas 2D is preferred|requiredMechanics|data-yaplix-|eventBridge/);
  assert.deepEqual(validateDocument(html.replaceAll('data-yaplix-','data-custom-')),[]);
  assert.equal(extractDocument('```html\n'+html+'\n```'),html.trim());
  for(const raw of [html+html,html+' trailing lost source',html.replace('</html>',''),'<html>partial'])assert.throws(()=>extractDocument(raw),/LLM_INVALID_HTML/);
});

test('default and legacy Auto never dispatch OpenRouter on Ollama failure or missing key',async()=>{
  let cloud=0,router=0;
  const a=source('ollama.com',async()=>{cloud++;throw new ProviderFailure('LLM_AUTH');}),b=source('openrouter',async()=>{router++;return{code:html,model:'cohere/north-mini-code:free'};});
  for(const mode of [undefined,'auto','ollama-cloud'] as const){const engine=new GenerationEngine([a,b],{check:evidence});await assert.rejects(engine.generate(spec,undefined,undefined,undefined,mode?{providerMode:mode,stage(){},dispatch(){},partial(){},attempt(){}}:undefined),/LLM_AUTH/);}
  assert.equal(cloud,3);assert.equal(router,0);
  assert.throws(()=>new GenerationEngine([b]).routesFor('auto'),/LLM_NOT_CONFIGURED/);
  const manual=new GenerationEngine([a,b],{defaultMode:'openrouter',check:evidence});assert.equal((await manual.generate(spec)).model,'cohere/north-mini-code:free');assert.equal(router,1);
  assert.throws(()=>configuredGenerator({CLOUD_API_KEY:'synthetic'})!.routesFor(),/LLM_NOT_CONFIGURED/);
});

test('edit sends only current complete HTML and new requirement; durable versions/idempotency survive reopen',async()=>{
  const store=new Store(':memory:'),seen:Message[][]=[];
  const engine=new GenerationEngine([source('ollama.com',async messages=>{seen.push(structuredClone(messages));return{code:html.replace('Collect','Collect and avoid'),model:'gemma4:31b'};})],{repairs:0,check:evidence});
  let jobs=new GenerationJobs(store,engine);
  try{
    const original=store.save(spec,{html,method:'mock',provider:'authored-test',model:null,generationStatus:'succeeded',validationStatus:'unverified'});
    const request={spec:{...spec,prompt:'Add enemies; preserve the map'},mode:'live' as const,providerMode:'ollama-cloud' as const,previousVersionId:original.versionId,telegramConsent:false};
    const id=jobs.create('owner','edit-full-source',request).jobId,result=await settled(jobs,id);
    assert.equal(result.stage,'completed');assert.equal(seen.length,1);assert.equal(seen[0].length,2);assert.ok(seen[0][1].content.endsWith(original.html));assert.match(seen[0][1].content,/Add enemies/);assert.match(seen[0][0].content,/retaining existing working mechanics/);
    assert.equal(store.history(original.gameId).length,2);assert.equal(store.getVersion(original.versionId).html,original.html);assert.equal(store.getVersion(result.versionId!).previousVersionId,original.versionId);
    await jobs.close();jobs=new GenerationJobs(store,engine);assert.equal(jobs.create('owner','edit-full-source',request).jobId,id);assert.equal(store.history(original.gameId).length,2);assert.equal(seen.length,1);
    assert.ok(jobs.get('owner',id).originalCheckpoint);
  }finally{await jobs.close();store.close();}
});

test('response body limit is local transport; HTTP 413 is a distinct external refusal, neither retries',async t=>{
  let scenario='local',posts=0;
  t.mock.method(globalThis,'fetch',async()=>{posts++;return scenario==='local'?new Response('x',{headers:{'content-length':'1210001'}}):new Response('upstream text including private values',{status:413});});
  const route=new CloudTransport({base:'https://openrouter.ai/api/v1',model:'openrouter/free',key:'synthetic'});
  for(scenario of ['local','http'])await assert.rejects(route.complete([],AbortSignal.timeout(1000)),new RegExp(scenario==='local'?'LLM_RESPONSE_BODY_TOO_LARGE':'LLM_HTTP_BODY_TOO_LARGE'));
  assert.equal(posts,2);
});

test('known context cap refuses full edit without POST; output budget is bounded by catalog',async t=>{
  let posts=0,contextLength=1000,body:any;
  t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{if(init?.method!=='POST')return Response.json({data:[{id:'gemma4:31b',context_length:contextLength,max_completion_tokens:8000}]});posts++;body=JSON.parse(String(init.body));return new Response('data: '+JSON.stringify({model:'gemma4:31b',choices:[{delta:{content:html},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');});
  const route=new CloudTransport({base:'https://ollama.com/v1',model:'gemma4:31b',key:'synthetic'}),ctx={stage(){},dispatch(){},partial(){},attempt(){}};
  await assert.rejects(route.complete(generationMessages(spec),AbortSignal.timeout(1000),ctx),/LLM_CONTEXT_LIMIT/);assert.equal(posts,0);
  contextLength=100000;await route.complete(generationMessages(spec),AbortSignal.timeout(1000),ctx);assert.equal(body.max_tokens,8000);assert.equal(posts,1);
  await assert.rejects(route.complete([{role:'user',content:'x'.repeat(300001)}],AbortSignal.timeout(1000),ctx),/LLM_INPUT_TOO_LARGE/);assert.equal(posts,1);
});

test('SSE JSON escaping can exceed HTML byte cap without exceeding the existing wire cap',async t=>{
  const code=html.replace('</body>','<!--'+ '"'.repeat(110000)+'--></body>');
  const wire=new TextEncoder().encode('data: '+JSON.stringify({model:'gemma4:31b',choices:[{delta:{content:code},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
  assert.ok(Buffer.byteLength(code)<200000);assert.ok(wire.length>200000);
  t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>init?.method!=='POST'?Response.json({data:[{id:'gemma4:31b'}]}):new Response(new ReadableStream({start(c){c.enqueue(wire.subarray(0,210000));c.enqueue(wire.subarray(210000));c.close();}})));
  const route=new CloudTransport({base:'https://ollama.com/v1',model:'gemma4:31b',key:'synthetic'});
  const result=await route.complete([],AbortSignal.timeout(1000),{stage(){},dispatch(){},partial(){},attempt(){}});assert.equal(result.code,code);
});
