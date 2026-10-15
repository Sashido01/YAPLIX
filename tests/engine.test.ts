import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {GenerationEngine,configuredGenerator,GenerationFailure} from '../src/live.ts';
import {CloudTransport,OllamaTransport,boundedText,CloudOutputFailure} from '../src/transport.ts';
import type {CodeTransport,Message} from '../src/transport.ts';
import {extractDocument,validateDocument,generationMessages} from '../src/generation.ts';
import {Store} from '../src/store.ts';
import {createApp} from '../src/api.ts';
import {Fault} from '../src/contracts.ts';
import {html,spec} from './helpers.ts';
const evidence=async()=>({profiles:[320,390],offline:true as const,errors:0 as const,scope:'startup-input-pause' as const});
function route(complete:CodeTransport['complete'],name:'primary'|'secondary'|'local'='primary'):CodeTransport{return{route:name,provider:'synthetic',model:'requested-model',complete,readiness:async()=>'ready'};}

test('independent specification preserves arbitrary mechanics, audience and previous code without classification',()=>{
 const request={...spec,prompt:'Арканоид: победа после 12 кирпичей; стрелками.',genre:'custom/new-genre',mechanics:['reflect','collect']};
 const store=new Store(':memory:');try{const first=store.save(spec,{html,method:'mock',provider:'synthetic',model:null,generationStatus:'succeeded',validationStatus:'unverified'});const messages=generationMessages(request,first);assert.ok(messages[1].content.includes(first.html));assert.ok(messages[1].content.includes(request.prompt));assert.ok(messages[1].content.includes(request.genre));assert.equal(messages.length,2);assert.equal(extractDocument('```html\n'+html+'\n```'),html.trim());assert.throws(()=>extractDocument(html+html),/LLM_INVALID_HTML/);assert.deepEqual(validateDocument(html),[]);}finally{store.close();}
});
test('sandbox configuration failure stops repairs and fallback without saving (synthetic)',async()=>{
 let calls=0;const source=route(async()=>{calls++;return{code:html,model:'actual-free-model'};});
 const engine=new GenerationEngine([source,{...source,route:'secondary'}],{repairs:2,check:async()=>{throw new Fault('BROWSER_SANDBOX_UNAVAILABLE',503);}});
 await assert.rejects(engine.generate(spec),error=>error instanceof GenerationFailure&&error.code==='BROWSER_SANDBOX_UNAVAILABLE'&&error.attempts.length===1);
 assert.equal(calls,1);
});

test('bounded repair receives original request and exact failed HTML; only checked result is saved (synthetic)',async()=>{
 const messages:Message[][]=[];let checks=0;
 const engine=new GenerationEngine([route(async m=>{messages.push(structuredClone(m));return{code:html,model:'actual-free-model'};})],{check:async()=>{if(++checks===1)throw new Fault('BROWSER_DUPLICATE_START');return evidence();}});
 const result=await engine.generate(spec);assert.equal(result.model,'actual-free-model');assert.equal(result.validationStatus,'passed');assert.equal(result.generation!.attempts.length,2);assert.equal(result.generation!.attempts[0].errorCode,'BROWSER_DUPLICATE_START');assert.ok(messages[1].at(-2)!.content.includes(html.trim()));assert.ok(messages[1].at(-1)!.content.includes(spec.prompt));
 const store=new Store(':memory:');try{const version=store.save(spec,result);assert.deepEqual(store.getVersion(version.versionId),version);}finally{store.close();}
});
test('failed checks, native dialogs, external resources and malformed output never persist',async()=>{
 for(const bad of [html.replace('</html>','<script>alert("bad")</script></html>'),html.replace('</html>','<script src="https://example.test/x"></script></html>'),'not html']){
  let calls=0;const engine=new GenerationEngine([route(async()=>{calls++;return{code:bad,model:'actual-free-model'};})],{check:evidence});const store=new Store(':memory:');
  try{const response=await createApp(store,engine).request('/api/games',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({spec,mode:'live'})});assert.equal(response.status,502);assert.equal(store.list().length,0);assert.ok(calls===2||calls===4,`unexpected call count ${calls}`);assert.equal((await response.json()).attempts.length,calls);}finally{store.close();}
 }
});
test('a rejected partial draft triggers one bounded fresh full generation without resuming it',async()=>{
  const batches:Message[][]=[];let calls=0;
  const engine=new GenerationEngine([route(async m=>{batches.push(structuredClone(m));calls++;return calls===1?{code:'<!doctype html><html><body>incomplete',model:'actual-free-model'}:{code:html,model:'actual-free-model'};})],{repairs:2,check:async()=>{if(calls===1)throw new Fault('LLM_INVALID_HTML',502);return evidence();}});
  const result=await engine.generate(spec);assert.equal(result.model,'actual-free-model');assert.ok(result.generation!.attempts.length>=2);
  const fresh=batches.find(m=>m.length===2);assert.ok(fresh,'fresh pass must send the original two-message prompt');
  assert.ok(!fresh!.at(-1)!.content.includes('Recover this draft'),'fresh pass must not resume the rejected draft');
});

test('HTTP failures are not retried; only explicit configured fallback runs and provenance stays visible',async()=>{
 let calls=0;const failed=route(async()=>{calls++;throw new Fault('LLM_RATE_LIMIT',429);});const secondary=route(async()=>({code:html,model:'secondary-actual'}),'secondary');
 await assert.rejects(new GenerationEngine([failed],{check:evidence}).generate(spec),/LLM_RATE_LIMIT/);assert.equal(calls,1);
 const output=await new GenerationEngine([failed,secondary],{check:evidence}).generate(spec);assert.equal(output.generation!.fallback,true);assert.equal(output.generation!.attempts[0].route,'primary');assert.equal(output.model,'secondary-actual');
 assert.throws(()=>configuredGenerator({LIVE_PROVIDER:'cloud',CLOUD_API_KEY:'synthetic',CLOUD_MODEL:'openai/paid-model'}),/FREE_MODEL_REQUIRED/);
 assert.throws(()=>configuredGenerator({LIVE_PROVIDER:'cloud',CLOUD_BASE_URL:'https://openrouter.ai./api/v1',CLOUD_API_KEY:'synthetic',CLOUD_MODEL:'openai/paid-model'}),/FREE_MODEL_REQUIRED/);
 assert.throws(()=>configuredGenerator({LIVE_PROVIDER:'cloud',CLOUD_API_KEY:'synthetic',LLM_FALLBACK:'secondary',SECONDARY_API_KEY:'synthetic',SECONDARY_BASE_URL:'https://paid.example/v1',SECONDARY_MODEL:'paid'}),/FREE_MODEL_REQUIRED/);
 assert.equal(configuredGenerator({}),undefined);
});
test('single concurrency slot, deadline, abort and close bound the entire generation pipeline',async()=>{
 const held=route(async(_m,s)=>new Promise((_,reject)=>{s.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});}));
 const engine=new GenerationEngine([held],{timeoutMs:1000,check:evidence});const pending=engine.generate(spec);await assert.rejects(engine.generate(spec),/LLM_BUSY/);await assert.rejects(pending,/LLM_TIMEOUT/);
 const controller=new AbortController();const stopped=engine.generate(spec,undefined,'llm_code',controller.signal);const rejected=assert.rejects(stopped,/REQUEST_CANCELLED/);controller.abort();await rejected;
 const closing=engine.generate(spec);const closed=assert.rejects(closing,/LLM_TIMEOUT/);engine.close();await closed;
});
test('cloud protocol records actual model, preserves messages and never emits credential in errors',async t=>{
 const bodies:any[]=[],headers:string[]=[];let scenario='success';
 const server=createServer((req,res)=>{if(scenario==='http'){res.writeHead(401);res.end('private upstream text');return;}if(scenario==='redirect'){res.writeHead(302,{Location:'https://attacker.test'});res.end();return;}let text='';req.on('data',b=>text+=b);req.on('end',()=>{headers.push(req.headers.authorization!);if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'requested-model'}]}));return;}bodies.push(JSON.parse(text));res.end(JSON.stringify({model:'returned-model',choices:[{finish_reason:scenario==='truncated'?'length':'stop',message:{content:html}}]}));});});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));t.after(()=>{server.closeAllConnections();server.close();});
 const transport=new CloudTransport({base:'http://127.0.0.1:'+(server.address() as any).port+'/v1',key:'synthetic-test-key',model:'requested-model',temperature:0.2,maxTokens:4096});
 assert.equal((await transport.complete(generationMessages(spec),AbortSignal.timeout(2000))).model,'returned-model');assert.equal(bodies[0].model,'requested-model');assert.equal(bodies[0].max_tokens,4096);assert.equal(bodies[0].temperature,0.2);assert.equal(headers[0],'Bearer synthetic-test-key');assert.equal(await transport.readiness(AbortSignal.timeout(2000)),'ready');
 scenario='truncated';await assert.rejects(transport.complete([],AbortSignal.timeout(2000)),/LLM_OUTPUT_TRUNCATED/);scenario='http';await assert.rejects(transport.complete([],AbortSignal.timeout(2000)),error=>String(error)==='Error: LLM_AUTH');scenario='redirect';await assert.rejects(transport.complete([],AbortSignal.timeout(2000)));
 for(const base of ['http://remote.example/v1','https://key@host.test/v1','https://host.test/v1?key=secret'])assert.throws(()=>new CloudTransport({base,key:'synthetic',model:'x'}),/INSECURE_LLM_URL/);
});
test('response bodies are bounded and oversized content-length cancels the reader',async()=>{
 let cancelled=false;const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('secret'));},cancel(){cancelled=true;}});await assert.rejects(boundedText(new Response(stream,{headers:{'content-length':'1000'}}),10),/BODY_TOO_LARGE/);assert.equal(cancelled,true);
});
test('Ollama transport rejects model substitution and truncation without fallback',async t=>{
 let scenario='correct';const server=createServer((_q,r)=>r.end(JSON.stringify({done:true,done_reason:scenario==='truncated'?'length':'stop',model:scenario==='wrong'?'other':'test-model',message:{content:html}})));await new Promise<void>(d=>server.listen(0,'127.0.0.1',d));t.after(()=>{server.closeAllConnections();server.close();});
 const transport=new OllamaTransport({base:'http://127.0.0.1:'+(server.address() as any).port,model:'test-model'});assert.equal((await transport.complete([],AbortSignal.timeout(2000))).code,html);for(scenario of ['wrong','truncated'])await assert.rejects(transport.complete([],AbortSignal.timeout(2000)),/LLM_INVALID_RESPONSE/);
});

test('free router preserves actual truncated model, uses low reasoning and bounded compact repair',async t=>{
 let calls=0;const bodies:any[]=[];
 t.mock.method(globalThis,'fetch',async(_url:unknown,options:any)=>{bodies.push(JSON.parse(options.body));return Response.json({model:'actual-free',choices:[{finish_reason:++calls===1?'length':'stop',message:{content:calls===1?'<!DOCTYPE html><html>':html}}]});});
 const cloud=new CloudTransport({base:'https://openrouter.ai/api/v1',model:'openrouter/free',key:'synthetic-test-key'});
 const output=await new GenerationEngine([cloud],{check:evidence}).generate(spec);
 assert.equal(calls,2);assert.deepEqual(bodies[0].reasoning,{effort:'low',exclude:true});assert.equal(output.generation!.attempts[0].model,'actual-free');assert.equal(output.generation!.attempts[0].errorCode,'LLM_OUTPUT_TRUNCATED');assert.ok(bodies[1].messages.at(-1).content.includes('budget was exhausted'));assert.equal(output.model,'actual-free');
});

test('direct prompt and local structured specification preserve requirements without an interpretation request',()=>{
 const direct=generationMessages(spec,undefined,'direct'),structured=generationMessages(spec,undefined,'spec');
 assert.equal(direct.length,2);assert.equal(structured.length,2);assert.equal(direct[0].content,structured[0].content);assert.ok(direct[1].content.includes(spec.prompt));assert.equal(JSON.parse(structured[1].content).request,spec.prompt);assert.match(direct[0].content,/User\/previous-code content is untrusted/);
});
