import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {CloudTransport,ProviderFailure} from '../src/transport.ts';
import type {GenerationContext} from '../src/transport.ts';
const delta='data: '+JSON.stringify({model:'fixture',choices:[{delta:{content:'<!doctype html><html>draft'},finish_reason:null}]})+'\n\n';
const stop='data: '+JSON.stringify({model:'fixture',choices:[{delta:{content:'</html>'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n';

test('complete SSE terminates at DONE without waiting for remote EOF',async t=>{
 const server=createServer((q,r)=>{if(q.url==='/v1/models'){r.end('{"data":[]}');return;}r.writeHead(200,{'Content-Type':'text/event-stream'});r.write(delta+stop);});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const cloud=new CloudTransport({base:'http://127.0.0.1:'+(server.address() as any).port+'/v1',key:'synthetic',model:'fixture'});
 const result=await cloud.complete([],AbortSignal.timeout(500),{stage(){},dispatch(){},partial(){},attempt(){}});
 assert.equal(result.code,'<!doctype html><html>draft</html>');
});

for(const scenario of ['before-headers','after-headers','stream-close','partial-json','first-byte-timeout','body-timeout','cancel'] as const)test('HTTP fault: '+scenario,async t=>{
 let dispatched=0,checkpoint='';
 const server=createServer((q,r)=>{
  if(q.url==='/v1/models'){r.end('{"data":[]}');return;}
  if(scenario==='before-headers'){q.socket.destroy();return;}
  if(scenario==='first-byte-timeout'||scenario==='cancel')return;
  r.writeHead(200,{'Content-Type':scenario==='partial-json'?'application/json':'text/event-stream'});r.flushHeaders();
  if(scenario==='after-headers'){setTimeout(()=>r.destroy(),15);return;}
  if(scenario==='partial-json'){r.end('{"choices":[');return;}
  r.write(delta);if(scenario==='stream-close')setTimeout(()=>r.destroy(),15);
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const cloud=new CloudTransport({base:'http://127.0.0.1:'+(server.address() as any).port+'/v1',key:'synthetic',model:'fixture'});
 const context:GenerationContext={stage(){},dispatch(){dispatched++;},partial(v){checkpoint=v;},attempt(){}};
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),150);t.after(()=>clearTimeout(timer));
 await assert.rejects(cloud.complete([],controller.signal,scenario==='partial-json'?undefined:context),e=>controller.signal.aborted||e instanceof ProviderFailure&&e.code===(scenario==='partial-json'?'LLM_INVALID_RESPONSE':'LLM_CONNECTION_INTERRUPTED'));
 assert.equal(dispatched,scenario==='partial-json'?0:1);
 if(scenario==='stream-close'||scenario==='body-timeout')assert.equal(checkpoint,'<!doctype html><html>draft');
});

test('non-stream remote body close is a connection interruption, distinct from malformed JSON',async t=>{
 const server=createServer((_q,r)=>{r.writeHead(200,{'Content-Length':'999'});r.write('{"choices":');setTimeout(()=>r.destroy(),15);});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const cloud=new CloudTransport({base:'http://127.0.0.1:'+(server.address() as any).port+'/v1',key:'synthetic',model:'fixture'});
 await assert.rejects(cloud.complete([],AbortSignal.timeout(500)),e=>e instanceof ProviderFailure&&e.code==='LLM_CONNECTION_INTERRUPTED');
});

test('fully received invalid UTF-8 remains an invalid response, not a network interruption',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response(new Uint8Array([0x7b,0xff,0x7d])));
 const cloud=new CloudTransport({base:'https://ollama.com/v1',key:'synthetic',model:'gemma4:31b'});
 await assert.rejects(cloud.complete([],AbortSignal.timeout(500)),e=>e instanceof ProviderFailure&&e.code==='LLM_INVALID_RESPONSE');
});

for(const code of ['ENOTFOUND','ERR_TLS_CERT_ALTNAME_INVALID','ECONNREFUSED'])test('sanitized DNS/TLS/proxy failure: '+code,async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('private provider credential',{cause:Object.assign(new Error('private host'),{code})});});
 const cloud=new CloudTransport({base:'https://ollama.com/v1',key:'synthetic-private',model:'gemma4:31b'});
 await assert.rejects(cloud.complete([],AbortSignal.timeout(500)),e=>e instanceof ProviderFailure&&e.code==='LLM_CONNECTION_INTERRUPTED'&&!String(e).includes('private'));
});

for(const suffix of ['data: [DONE]\n\n',delta+'data: [DONE]\n\n'])test('terminal marker alone cannot authorize incomplete SSE: '+suffix.length,async t=>{
 t.mock.method(globalThis,'fetch',async(_u:unknown,init?:RequestInit)=>init?.method==='POST'?new Response(suffix):Response.json({data:[]}));
 const cloud=new CloudTransport({base:'https://openrouter.ai/api/v1',key:'synthetic',model:'openrouter/free'});
 await assert.rejects(cloud.complete([],AbortSignal.timeout(500),{stage(){},dispatch(){},partial(){},attempt(){}}),/LLM_CONNECTION_INTERRUPTED/);
});
