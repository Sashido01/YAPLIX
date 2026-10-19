import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {LocalSiwc,SIWC} from '../src/experimental/siwc.ts';

const keys=await generateKeyPair('RS256');
const jwk={...await exportJWK(keys.publicKey),kid:'offline-test',alg:'RS256',use:'sig'};
const scopes='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const otherKeys=await generateKeyPair('RS256');

// Public seam: signed OAuth -> account catalog -> one Responses stream.
// OpenAI HTTP is synthetic; the callback uses a real loopback socket.
async function probeSession(request:typeof fetch){
 let authorization!:URL;
 const directory=mkdtempSync('.local/siwc-probe-test-');
 const auth=new LocalSiwc({directory,request:async(input,init)=>{
  const url=String(input);
  if(url===SIWC.discovery)return Response.json({issuer:SIWC.issuer,authorization_endpoint:SIWC.authorize,token_endpoint:SIWC.token,jwks_uri:SIWC.jwks});
  if(url===SIWC.jwks)return Response.json({keys:[jwk]});
  if(url!==SIWC.token)return request(input,init);
  const token=await new SignJWT({nonce:authorization.searchParams.get('nonce')}).setProtectedHeader({alg:'RS256',kid:'offline-test'}).setIssuer(SIWC.issuer).setAudience('oaiapp_offline').setSubject('offline-subject').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
  return Response.json({access_token:'offline-access-credential',refresh_token:'offline-refresh-credential',id_token:token,token_type:'Bearer',expires_in:3600,scope:scopes});
 },openBrowser:async value=>{
  authorization=new URL(value);const callback=new URL(authorization.searchParams.get('redirect_uri')!);
  callback.search=new URLSearchParams({state:authorization.searchParams.get('state')!,code:'offline-code',client_id:'oaiapp_offline'}).toString();
  await fetch(callback);
 }});
 await auth.signIn();return{auth,directory};
}

test('SIWC preserves streamed text when completed output is empty and retains safe diagnostics',async()=>{
 const {auth}=await probeSession(async input=>{
  if(String(input).endsWith('/models'))return Response.json({models:[{slug:'gpt-6.1-sol',display_name:'GPT-6.1 Sol',visibility:'list'}]});
  const events=[{type:'response.output_text.delta',output_index:0,content_index:0,delta:'YAPLIX READY'},
   {type:'response.completed',response:{status:'completed',model:'gpt-6.1-sol',output:[],usage:{input_tokens:3,output_tokens:4,total_tokens:7}}}];
  return new Response(events.map(value=>'data: '+JSON.stringify(value)+'\n\n').join(''));
 });
 try{
  const report=await auth.probe();assert.equal(report.result,'PASS');
  assert.equal(report.diagnostics.textLength,12);assert.equal(report.diagnostics.lastEventType,'response.completed');
  assert.deepEqual(report.usage,{input_tokens:3,output_tokens:4,total_tokens:7});
  assert.ok(!Object.hasOwn(report,'text'));assert.ok(!JSON.stringify(report).includes('YAPLIX READY'));
 }finally{auth.dispose();}
});

const completion=(output:unknown[]=[],extra:object={})=>({type:'response.completed',response:{status:'completed',model:'gpt-6.1-sol',output,...extra}});
const message=(text:string)=>({type:'message',role:'assistant',content:[{type:'output_text',text}]});
const delta=(value:string,content=0)=>({type:'response.output_text.delta',output_index:0,content_index:content,delta:value});
const doneText=(value:string,content=0)=>({type:'response.output_text.done',output_index:0,content_index:content,text:value});
for(const [kind,model,error] of [
 ['missing',undefined,'SIWC_MODEL_ACTUAL_NOT_VERIFIED'],
 ['wrong','gpt-6-astra','SIWC_MODEL_ACTUAL_MISMATCH'],
 ['untrusted','offline-access-credential','SIWC_MODEL_ACTUAL_MISMATCH'],
] as const)test('SIWC requires actual response model evidence: '+kind,async()=>{
 const {report}=await diagnosticProbe([completion([message('YAPLIX READY')],{model})]);
 assert.equal(report.result,'PARTIAL');assert.equal(report.error,error);
 assert.equal(report.requestedModel,'gpt-6.1-sol');
 assert.equal(report.actualModel,kind==='missing'?null:kind==='wrong'?'gpt-6-astra':'OTHER');
 assert.equal(report.diagnostics.textLength,12);assert.ok(!JSON.stringify(report).includes('credential'));
});
test('SIWC rejects conflicting models across response events',async()=>{
 const {report}=await diagnosticProbe([{type:'response.created',response:{model:'gpt-6-astra'}},
  completion([message('YAPLIX READY')],{model:'gpt-6.1-sol'})]);
 assert.equal(report.result,'PARTIAL');assert.equal(report.error,'SIWC_MODEL_ACTUAL_MISMATCH');
 assert.equal(report.actualModel,'CONFLICT');
});
async function diagnosticProbe(events:unknown[],raw?:string){
 const wire=raw??events.map(value=>'data: '+JSON.stringify(value)+'\n\n').join('');
 const {auth}=await probeSession(async input=>String(input).endsWith('/models')?
  Response.json({models:[{slug:'gpt-6.1-sol',display_name:'GPT-6.1 Sol',visibility:'list'}]}):new Response(wire));
 try{return{report:await auth.probe(),wireBytes:Buffer.byteLength(wire)};}finally{auth.dispose();}
}

for(const [kind,events,length,result] of [
 ['done-only',[doneText('YAPLIX READY'),completion()],12,'PASS'],
 ['final-only',[completion([message('YAPLIX READY')])],12,'PASS'],
 ['delta-done-final',[delta('YAPLIX '),delta('READY'),doneText('YAPLIX READY'),completion([message('YAPLIX READY')])],12,'PASS'],
 ['indexed-parts',[delta('YAPLIX '),delta('READY',1),doneText('READY',1),completion([message('YAPLIX ')])],12,'PASS'],
 ['repeated-substrings',[delta('ha'),delta('ha'),doneText('haha'),completion([message('haha')])],4,'PARTIAL'],
 ['final-authoritative',[delta('old draft'),doneText('old draft'),completion([message('YAPLIX READY')])],12,'PASS'],
] as const)test('SIWC extracts text without duplicating snapshots: '+kind,async()=>{
 const {report,wireBytes}=await diagnosticProbe([...events]);
 assert.equal(report.result,result);assert.equal(report.inference,'COMPLETED');assert.equal(report.diagnostics.textLength,length);
 assert.equal(report.diagnostics.textPresent,true);assert.equal(report.diagnostics.responseStatus,'completed');
 assert.equal(report.diagnostics.lastEventType,'response.completed');assert.equal(report.diagnostics.receivedBytes,wireBytes);
 assert.ok(!Object.hasOwn(report,'text'));assert.ok(!JSON.stringify(report).includes('YAPLIX READY'));
});

for(const [kind,events,inference,error,status] of [
 ['empty',[completion([], {usage:{input_tokens:1,output_tokens:0,total_tokens:1}})],'COMPLETED_EMPTY','SIWC_COMPLETED_WITHOUT_TEXT','completed'],
 ['failed',[{type:'response.failed',response:{status:'failed',error:{code:'server_error',message:'SENSITIVE_PAYLOAD'},usage:{input_tokens:1,output_tokens:0,total_tokens:1}}}],'FAILED','SIWC_INFERENCE_FAILED','failed'],
 ['incomplete',[delta('part'),{type:'response.incomplete',response:{status:'incomplete',incomplete_details:{reason:'max_output_tokens'},usage:{input_tokens:1,output_tokens:0,total_tokens:1}}}],'INCOMPLETE','SIWC_INFERENCE_INCOMPLETE','incomplete'],
 ['error',[{type:'error',code:'invalid_request_error',message:'SENSITIVE_PAYLOAD',usage:{input_tokens:1,output_tokens:0,total_tokens:1}}],'ERROR','SIWC_INFERENCE_FAILED',null],
 ['interrupted',[delta('part')],'INTERRUPTED','SIWC_STREAM_INTERRUPTED',null],
 ['reasoning-only',[{type:'response.reasoning_text.delta',delta:'SENSITIVE_PAYLOAD'},completion([], {usage:{input_tokens:1,output_tokens:0,total_tokens:1}})],'COMPLETED_EMPTY','SIWC_COMPLETED_WITHOUT_TEXT','completed'],
] as const)test('SIWC distinguishes terminal outcomes and preserves metadata: '+kind,async()=>{
 const {report,wireBytes}=await diagnosticProbe([...events]);
 assert.equal(report.result,'PARTIAL');assert.equal(report.inference,inference);assert.equal(report.error,error);
 assert.equal(report.diagnostics.responseStatus,status);assert.equal(report.diagnostics.receivedBytes,wireBytes);
 const last=events[events.length-1].type;assert.equal(report.diagnostics.lastEventType,last);
 assert.equal(report.diagnostics.eventCounts[last as keyof typeof report.diagnostics.eventCounts],1);
 assert.equal(report.diagnostics.textLength,kind==='incomplete'||kind==='interrupted'?4:0);
 if(kind!=='interrupted')assert.deepEqual(report.usage,{input_tokens:1,output_tokens:0,total_tokens:1});
 if(kind==='failed')assert.equal(report.diagnostics.apiErrorCode,'server_error');
 if(kind==='error')assert.equal(report.diagnostics.apiErrorCode,'invalid_request_error');
 if(kind==='incomplete')assert.equal(report.diagnostics.incompleteReason,'max_output_tokens');
 assert.ok(!JSON.stringify(report).includes('SENSITIVE_PAYLOAD'));
});

test('SIWC records known event counts and never serializes provider text or arbitrary metadata',async()=>{
 const {report}=await diagnosticProbe([
  {type:'response.created',response:{status:'in_progress'}},delta('secret-answer'),doneText('secret-answer'),
  {type:'response.reasoning_summary_text.delta',delta:'private-reasoning'},
  {type:'response.SENSITIVE_EVENT',payload:'private-payload'},
  {type:'response.incomplete',response:{status:'incomplete',error:{code:'offline-access-credential'},incomplete_details:{reason:'offline-refresh-credential'},usage:{input_tokens:2,output_tokens:'secret',total_tokens:3,secret:'private-payload'}}},
 ]);
 assert.equal(report.inference,'INCOMPLETE');assert.equal(report.diagnostics.apiErrorCode,'OTHER');assert.equal(report.diagnostics.incompleteReason,'OTHER');
 assert.deepEqual(report.diagnostics.eventCounts,{'response.created':1,'response.output_text.delta':1,'response.output_text.done':1,'response.reasoning_summary_text.delta':1,unknown:1,'response.incomplete':1});
 assert.equal(report.diagnostics.textLength,13);assert.deepEqual(report.usage,{input_tokens:2,total_tokens:3});
 for(const forbidden of ['secret-answer','private-reasoning','private-payload','SENSITIVE_EVENT','credential'])assert.ok(!JSON.stringify(report).includes(forbidden));
});

test('SIWC reports invalid SSE separately with bounded byte diagnostics',async()=>{
 const {report,wireBytes}=await diagnosticProbe([],'data: {invalid}\n\n');
 assert.equal(report.result,'PARTIAL');assert.equal(report.error,'SIWC_SSE_INVALID');assert.equal(report.inference,'INVALID_SSE');
 assert.equal(report.diagnostics.receivedBytes,wireBytes);assert.equal(report.diagnostics.lastEventType,null);assert.equal(report.diagnostics.textLength,0);
});

for(const kind of ['reader-failure','invalid-utf8-tail'] as const)test('SIWC distinguishes '+kind+' after receiving streamed text',async()=>{
 const prefix=new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"part"}\n\n');let pulls=0;
 const {auth}=await probeSession(async input=>{
  if(String(input).endsWith('/models'))return Response.json({models:[{slug:'gpt-6.1-sol',display_name:'GPT-6.1 Sol',visibility:'list'}]});
  const stream=new ReadableStream<Uint8Array>({pull(controller){
   if(pulls++===0){controller.enqueue(prefix);return;}
   if(kind==='reader-failure')controller.error(Error('SENSITIVE_SOCKET_DETAIL'));
   else{controller.enqueue(Uint8Array.of(0xd0));controller.close();}
  }});
  return new Response(stream);
 });
 try{
  const report=await auth.probe();assert.equal(report.result,'PARTIAL');
  assert.equal(report.inference,kind==='reader-failure'?'INTERRUPTED':'INVALID_SSE');
  assert.equal(report.error,kind==='reader-failure'?'SIWC_STREAM_INTERRUPTED':'SIWC_SSE_INVALID');
  assert.equal(report.diagnostics.textLength,4);assert.equal(report.diagnostics.eventCounts['response.output_text.delta'],1);
  assert.ok(!JSON.stringify(report).includes('SENSITIVE_SOCKET_DETAIL'));
 }finally{auth.dispose();}
});

test('SIWC probe uses the visible account catalog and exactly one contract-compliant completed inference',async()=>{
 const calls:string[]=[];
 const {auth,directory}=await probeSession(async(input,init)=>{
  calls.push(String(input));assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer offline-access-credential');
  assert.equal(init?.redirect,'error');
  if(String(input).endsWith('/models'))return Response.json({models:[
   {slug:'gpt-hidden',display_name:'Hidden',visibility:'hide'},
   {slug:'gpt-6-astra',display_name:'GPT-6 Astra',visibility:'list'},
   {slug:'gpt-6.1-sol',display_name:'GPT-6.1 Sol',visibility:'list'},
   {slug:'gpt-99-astra',display_name:'Future GPT',visibility:'list'}]});
  assert.deepEqual(JSON.parse(String(init?.body)),{model:'gpt-6.1-sol',input:[{role:'user',content:'Ответь точно: YAPLIX READY'}],store:false,stream:true,reasoning:{effort:'medium'}});
  return new Response('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',model:'gpt-6.1-sol',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'YAPLIX READY'}]}],usage:{input_tokens:12,output_tokens:4,total_tokens:16}}})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});
 });
 try{
  const report=await auth.probe();assert.equal(report.result,'PASS');assert.equal(report.inference,'COMPLETED');assert.equal(report.diagnostics.textLength,12);
  assert.equal(report.selectedModel?.slug,'gpt-6.1-sol');assert.deepEqual(report.providerCalls,{modelsGet:1,inferencePost:1});
  assert.deepEqual(report.usage,{input_tokens:12,output_tokens:4,total_tokens:16});
  assert.deepEqual(calls,['https://api.openai.com/v1/models','https://api.openai.com/v1/responses']);
  await assert.rejects(auth.probe(),{message:'SIWC_PROBE_ALREADY_USED'});assert.equal(calls.length,2);
  const stored=readdirSync(directory).map(f=>readFileSync(directory+'/'+f,'utf8')).join('');
  assert.ok(!stored.includes('credential'));assert.ok(!JSON.stringify(report).includes('credential'));
 }finally{auth.dispose();}
});

test('SIWC probe consumes actual SSE without relying solely on Content-Type',async()=>{
 const {auth}=await probeSession(async input=>{
  if(String(input).endsWith('/models'))return Response.json({models:[{slug:'gpt-6.1-sol',display_name:'Test GPT',visibility:'list'}]});
  const bytes=new TextEncoder().encode('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',model:'gpt-6.1-sol',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'YAPLIX READY'}]}]}})+'\n\n');
  return new Response(bytes); // Deliberately no media type; still genuine SSE framing.
 });
 try{
  const report=await auth.probe();assert.equal(report.result,'PASS');assert.equal(report.inference,'COMPLETED');
  assert.equal(report.responseMediaType,'missing');assert.equal(report.sseObserved,true);
  assert.deepEqual(report.providerCalls,{modelsGet:1,inferencePost:1});
 }finally{auth.dispose();}
});

for(const slug of ['gpt-6-astra','gpt-6.1-sol-pro','gpt-6.1-sol-latest'])test('SIWC probe stops before POST when only '+slug+' is available',async()=>{
 let gets=0,posts=0;
 const {auth}=await probeSession(async input=>{
  if(String(input).endsWith('/models')){gets++;return Response.json({models:[{slug,display_name:'Alternative GPT',visibility:'list'}]});}
  posts++;throw Error('must never substitute');
 });
 try{
  const report=await auth.probe();assert.equal(report.error,'SIWC_PROBE_MODEL_UNAVAILABLE');assert.equal(report.selectedModel,null);
  assert.equal(report.inference,'NOT_RUN');assert.equal(gets,1);assert.equal(posts,0);
  assert.deepEqual(report.providerCalls,{modelsGet:1,inferencePost:0});
 }finally{auth.dispose();}
});

for(const [mediaType,newline] of [['text/event-stream','\r'],['text/plain','\n'],['application/json','\r\n']] as const)test('SIWC probe validates fragmented SSE frames with '+mediaType+' and '+JSON.stringify(newline),async()=>{
 const {auth}=await probeSession(async input=>{
  if(String(input).endsWith('/models'))return Response.json({models:[{slug:'gpt-6.1-sol',display_name:'GPT-6.1 Sol',visibility:'list'}]});
  const wire='\uFEFF: heartbeat'+newline+newline+'event: response.completed'+newline+
   'data: {"type":"response.completed",'+newline+
   'data: "response":{"status":"completed","model":"gpt-6.1-sol","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"YAPLIX READY"}]}]}}'+newline+newline;
  const bytes=new TextEncoder().encode(wire);
  return new Response(new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();}}),{headers:{'Content-Type':mediaType}});
 });
 try{
  const report=await auth.probe();assert.equal(report.result,'PASS');assert.equal(report.sseObserved,true);assert.equal(report.diagnostics.textLength,12);
 }finally{auth.dispose();}
});

for(const [kind,expected] of [
 ['json-completed','SIWC_SSE_REQUIRED'],['json-limit','SIWC_USAGE_LIMIT'],
 ['json-error','SIWC_INFERENCE_FAILED'],['html','SIWC_SSE_REQUIRED'],
 ['done-only','SIWC_SSE_REQUIRED'],['delta-only','SIWC_STREAM_INTERRUPTED'],
 ['truncated-completed','SIWC_SSE_REQUIRED'],
] as const)test('SIWC probe never treats '+kind+' as completed SSE',async()=>{
 const {auth}=await probeSession(async input=>{
  if(String(input).endsWith('/models'))return Response.json({models:[{slug:'gpt-6.1-sol',display_name:'GPT-6.1 Sol',visibility:'list'}]});
  if(kind==='json-completed')return Response.json({type:'response.completed',response:{status:'completed',model:'gpt-6.1-sol',output_text:'YAPLIX READY'}});
  if(kind==='json-limit'||kind==='json-error')return Response.json({error:{code:kind==='json-limit'?'subscription_sharing_usage_limit_exceeded':'offline-access-credential',message:'offline-refresh-credential'}});
  const wire=kind==='html'?'<html>offline-access-credential</html>':kind==='done-only'?'data: [DONE]\n\n':kind==='delta-only'?'data: {"type":"response.output_text.delta","delta":"YAPLIX READY"}\n\n':'data: {"type":"response.completed","response":{"status":"completed"}}';
  return new Response(wire,{headers:{'Content-Type':'text/event-stream'}});
 });
 try{
  const report=await auth.probe();assert.equal(report.result,'PARTIAL');assert.equal(report.error,expected);assert.notEqual(report.inference,'COMPLETED');
  assert.deepEqual(report.providerCalls,{modelsGet:1,inferencePost:1});assert.ok(!JSON.stringify(report).includes('credential'));
 }finally{auth.dispose();}
});

for(const [kind,expected,posts] of [
 ['catalog-http','SIWC_MODELS_HTTP',0],['catalog-invalid','SIWC_MODELS_INVALID',0],
 ['hidden-only','SIWC_PROBE_MODEL_UNAVAILABLE',0],['data-array','SIWC_MODELS_INVALID',0],
 ['post-http','SIWC_INFERENCE_HTTP',1],['network','SIWC_PROBE_INVALID_OR_NETWORK',1],
 ['no-completed','SIWC_STREAM_INTERRUPTED',1],['incomplete','SIWC_INFERENCE_INCOMPLETE',1],
 ['failed','SIWC_INFERENCE_FAILED',1],['limit','SIWC_USAGE_LIMIT',1],['unavailable','SIWC_USAGE_UNAVAILABLE',1],
 ['bad-json','SIWC_SSE_INVALID',1],['no-sse','SIWC_SSE_REQUIRED',1],
 ['empty-output','SIWC_COMPLETED_WITHOUT_TEXT',1],['oversized','SIWC_RESPONSE_TOO_LARGE',1],
 ['stalled','SIWC_PROBE_CANCELLED',1],
] as const)test('SIWC probe stops without retry or credential leakage: '+kind,async()=>{
 let gets=0,inferencePosts=0,bodyCancelled=false;
 const {auth}=await probeSession(async(input)=>{
  if(String(input).endsWith('/models')){
   gets++;
   if(kind==='catalog-http')return new Response('SENSITIVE offline-access-credential',{status:403});
   if(kind==='catalog-invalid')return Response.json({models:null});
   if(kind==='data-array')return Response.json({data:[{id:'gpt-6.1-sol'}]});
   return Response.json({models:[{slug:'gpt-6.1-sol',display_name:'GPT test',visibility:kind==='hidden-only'?'hide':'list'}]});
  }
  inferencePosts++;
  if(kind==='post-http')return new Response('SENSITIVE offline-refresh-credential',{status:429});
  if(kind==='network')throw Error('SENSITIVE offline-access-credential');
  if(kind==='no-sse')return Response.json({type:'response.completed'});
  if(kind==='stalled')return new Response(new ReadableStream({cancel(){bodyCancelled=true;}}),{headers:{'Content-Type':'text/event-stream'}});
  const type=kind==='incomplete'?'response.incomplete':['failed','limit','unavailable'].includes(kind)?'response.failed':kind==='empty-output'?'response.completed':'response.output_text.delta';
  const errorCode=kind==='limit'?'subscription_sharing_usage_limit_exceeded':kind==='unavailable'?'subscription_sharing_usage_unavailable':'SENSITIVE offline-access-credential';
  const data=kind==='bad-json'?'{invalid':JSON.stringify({type,delta:kind==='oversized'?'x'.repeat(70000):'YAPLIX READY',response:{status:'completed',model:'gpt-6.1-sol',output:[],error:kind==='empty-output'?null:{code:errorCode,message:'offline-refresh-credential'}}});
  return new Response('data: '+data+'\n\n',{headers:{'Content-Type':'text/event-stream'}});
 });
 try{
  const report=await auth.probe({timeoutMs:kind==='stalled'?100:5000});
  assert.equal(report.result,'PARTIAL');assert.equal(report.error,expected);assert.notEqual(report.inference,'COMPLETED');
  assert.deepEqual(report.providerCalls,{modelsGet:1,inferencePost:posts});assert.equal(gets,1);assert.equal(inferencePosts,posts);
  assert.ok(!/credential|SENSITIVE/.test(JSON.stringify(report)));
  if(kind==='stalled')assert.equal(bodyCancelled,true);
  await assert.rejects(auth.probe(),{message:'SIWC_PROBE_ALREADY_USED'});assert.equal(inferencePosts,posts);
 }finally{auth.dispose();}
});

test('SIWC probe handles fragmented UTF-8/CRLF SSE and withholds unexpected output and unsafe usage',async()=>{
 const {auth}=await probeSession(async input=>{
  if(String(input).endsWith('/models'))return Response.json({models:[{slug:'gpt-6.1-sol',display_name:'offline-access-credential',visibility:'list'}]});
  const events=[{type:'response.output_text.delta',delta:'Готово'},
   {type:'response.completed',response:{status:'completed',model:'gpt-6.1-sol',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'offline-access-credential'}]}],usage:{input_tokens:1,output_tokens:'offline-refresh-credential',total_tokens:-1,secret:'offline-access-credential'}}}];
  const bytes=new TextEncoder().encode(': keepalive\r\n\r\n'+events.map(event=>'event: '+event.type+'\r\ndata: '+JSON.stringify(event)+'\r\n\r\n').join(''));
  return new Response(new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();}}),{headers:{'Content-Type':'text/event-stream; charset=utf-8'}});
 });
 try{
  const report=await auth.probe();assert.equal(report.result,'PARTIAL');assert.equal(report.error,'SIWC_OUTPUT_UNEXPECTED');assert.equal(report.exactMatch,false);assert.equal(report.textReceived,true);
  assert.equal(report.diagnostics.textLength,25);assert.ok(!Object.hasOwn(report,'text'));assert.deepEqual(report.usage,{input_tokens:1});
  assert.ok(!JSON.stringify(report).includes('credential'));
 }finally{auth.dispose();}
});

test('SIWC probe requires a live in-memory grant and makes no calls after disposal or pre-cancel',async()=>{
 let calls=0;const {auth}=await probeSession(async()=>{calls++;throw Error('must not send');});
 try{
  const cancelled=new AbortController();cancelled.abort();
  const report=await auth.probe({signal:cancelled.signal});assert.equal(report.error,'SIWC_PROBE_CANCELLED');
  assert.deepEqual(report.providerCalls,{modelsGet:0,inferencePost:0});assert.equal(calls,0);
 }finally{auth.dispose();}
 const fresh=new LocalSiwc({openBrowser:async()=>{throw Error('must not open');},request:async()=>{calls++;throw Error('must not send');}});
 await assert.rejects(fresh.probe(),{message:'SIWC_PLAN_PERMISSION_REQUIRED'});assert.equal(calls,0);
});

test('isolated SIWC registers with PKCE, validates signed identity, persists only non-secret metadata and cleans callback',{timeout:15000},async()=>{
 const directory=mkdtempSync('.local/siwc-test-');let authUrl!:URL,callback!:URL,calls=0;
 const auth=new LocalSiwc({directory,timeoutMs:5000,request:async(input,init)=>{
  const url=String(input);
  if(url===SIWC.discovery)return Response.json({issuer:SIWC.issuer,authorization_endpoint:SIWC.authorize,token_endpoint:SIWC.token,jwks_uri:SIWC.jwks});
  if(url===SIWC.jwks)return Response.json({keys:[jwk]});
  assert.equal(url,SIWC.token);calls++;const form=new URLSearchParams(String(init?.body));
  assert.equal(form.get('client_id'),'oaiapp_offline');assert.equal(form.get('redirect_uri'),authUrl.searchParams.get('redirect_uri'));
  assert.equal(createHash('sha256').update(form.get('code_verifier')!).digest('base64url'),authUrl.searchParams.get('code_challenge'));
  const token=await new SignJWT({nonce:authUrl.searchParams.get('nonce')}).setProtectedHeader({alg:'RS256',kid:'offline-test'}).setIssuer(SIWC.issuer).setAudience('oaiapp_offline').setSubject('offline-subject').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
  return Response.json({access_token:'offline-access-credential',refresh_token:'offline-refresh-credential',id_token:token,token_type:'Bearer',expires_in:3600,scope:scopes});
 },openBrowser:async(value)=>{
  authUrl=new URL(value);assert.equal(authUrl.origin,'https://auth.openai.com');assert.equal(authUrl.searchParams.get('client_id'),calls?'oaiapp_offline':'dynamic_agent_client');assert.equal(authUrl.searchParams.get('agent_name_hint'),calls?null:'YAPLIX');
  callback=new URL(authUrl.searchParams.get('redirect_uri')!);callback.search=new URLSearchParams({state:authUrl.searchParams.get('state')!,code:'offline-code',...(!calls?{client_id:'oaiapp_offline'}:{})}).toString();
  assert.equal((await fetch(callback)).status,200);
 }});
 try{
  const host=auth.prepare().hostId;assert.equal(auth.prepare().hostId,host);
  assert.deepEqual(await auth.signIn(),{connected:true,planPermissionGranted:true,registered:true});assert.equal(calls,1);
  const firstState=authUrl.searchParams.get('state'),firstNonce=authUrl.searchParams.get('nonce');
  assert.deepEqual(await auth.signIn(),{connected:true,planPermissionGranted:true,registered:true});assert.equal(calls,2);
  assert.notEqual(authUrl.searchParams.get('state'),firstState);assert.notEqual(authUrl.searchParams.get('nonce'),firstNonce);assert.equal(auth.prepare().hostId,host);
  const files=readdirSync(directory);assert.deepEqual(files.sort(),['host.json','registration.json']);
  const stored=files.map(f=>readFileSync(directory+'/'+f,'utf8')).join('');
  for(const forbidden of ['offline-access-credential','offline-refresh-credential','offline-code','code_verifier','id_token'])assert.ok(!stored.includes(forbidden));
  assert.ok(!JSON.stringify(auth).includes('credential'));
  auth.dispose();assert.equal(auth.status().connected,false);
  await assert.rejects(fetch(callback));
 }finally{auth.dispose();}
});

for(const [kind,expected] of [
 ['denied','SIWC_AUTH_DENIED'],['state','SIWC_STATE_INVALID'],['duplicate','SIWC_CALLBACK_INVALID'],
 ['client','SIWC_CLIENT_INVALID'],['client-swap','SIWC_CLIENT_INVALID'],['code','SIWC_CALLBACK_INVALID'],['permission','SIWC_PLAN_PERMISSION_REQUIRED'],['scope','SIWC_SCOPES_REQUIRED'],
 ['signature','SIWC_ID_TOKEN_INVALID'],['issuer','SIWC_ID_TOKEN_INVALID'],['audience','SIWC_ID_TOKEN_INVALID'],
 ['expired','SIWC_ID_TOKEN_INVALID'],['nonce','SIWC_ID_TOKEN_INVALID'],['subject','SIWC_ID_TOKEN_INVALID'],['account','SIWC_ID_TOKEN_INVALID'],
 ['discovery','SIWC_DISCOVERY_INVALID'],['network','SIWC_NETWORK'],['token-network','SIWC_NETWORK'],
 ['browser','SIWC_AUTH_FAILED'],['timeout','SIWC_CANCELLED'],['abort','SIWC_CANCELLED'],
] as const)test('SIWC rejects '+kind+' and clears temporary authorization data',{timeout:10000},async()=>{
 const directory=mkdtempSync('.local/siwc-failure-');let authorization:URL|undefined,callback:URL|undefined,exchanges=0;
 if(kind==='account'||kind==='client-swap')writeFileSync(directory+'/registration.json',JSON.stringify({clientId:'oaiapp_offline',issuer:SIWC.issuer,subject:'original-subject'}));
 const cancelled=new AbortController();
 const auth=new LocalSiwc({directory,timeoutMs:kind==='timeout'?100:3000,request:async(input)=>{
  const url=String(input);
  if(kind==='network')throw Error('SENSITIVE_NETWORK_DETAIL');
  if(url===SIWC.discovery)return Response.json({issuer:SIWC.issuer,authorization_endpoint:SIWC.authorize,token_endpoint:kind==='discovery'?'https://invalid.test/token':SIWC.token,jwks_uri:SIWC.jwks});
  if(url===SIWC.jwks)return Response.json({keys:[jwk]});
  assert.equal(url,SIWC.token);exchanges++;
  if(kind==='token-network')throw Error('SENSITIVE_NETWORK_DETAIL');
  let jwt=new SignJWT({nonce:kind==='nonce'?'wrong-nonce':authorization!.searchParams.get('nonce')}).setProtectedHeader({alg:'RS256',kid:'offline-test'}).setIssuer(kind==='issuer'?'https://invalid.test':SIWC.issuer).setAudience(kind==='audience'?'wrong-client':'oaiapp_offline').setIssuedAt().setExpirationTime(kind==='expired'?'1s':'5m');
  if(kind!=='subject')jwt=jwt.setSubject('offline-subject');
  if(kind==='expired')jwt=jwt.setExpirationTime(Math.floor(Date.now()/1000)-60);
  const token=await jwt.sign(kind==='signature'?otherKeys.privateKey:keys.privateKey);
  return Response.json({access_token:'offline-access-credential',refresh_token:'offline-refresh-credential',id_token:token,token_type:'Bearer',expires_in:3600,scope:kind==='permission'?'openid profile email':kind==='scope'?'openid chatgpt.tokens.use.direct':scopes});
 },openBrowser:async(value)=>{
  authorization=new URL(value);callback=new URL(authorization.searchParams.get('redirect_uri')!);
  if(kind==='browser')throw Error('SENSITIVE_BROWSER_DETAIL');
  if(kind==='timeout')return;
  if(kind==='abort'){cancelled.abort();return;}
  callback.search=new URLSearchParams({state:kind==='state'?'wrong-state':authorization.searchParams.get('state')!,code:kind==='code'?'':'offline-code',client_id:kind==='client'?'dynamic_agent_client':kind==='client-swap'?'oaiapp_other':'oaiapp_offline',...(kind==='denied'?{error:'access_denied',error_description:'SENSITIVE_CALLBACK_DETAIL'}:{})}).toString();
  if(kind==='duplicate')callback.searchParams.append('state','duplicate');
  await fetch(callback).catch(()=>{});
 }});
 try{
  await assert.rejects(auth.signIn(cancelled.signal),{message:expected});
  assert.equal(auth.status().connected,false);
  if(['denied','state','duplicate','client','client-swap','code','discovery','network','browser','timeout','abort'].includes(kind))assert.equal(exchanges,0);
  else assert.equal(exchanges,1);
  const files=readdirSync(directory);assert.ok(!files.some(f=>f.endsWith('.lock')||f.endsWith('.tmp')));
  for(const file of files){const stored=readFileSync(directory+'/'+file,'utf8');for(const forbidden of ['offline-access-credential','offline-refresh-credential','offline-code','SENSITIVE_'])assert.ok(!stored.includes(forbidden));}
  if(kind==='account'||kind==='client-swap')assert.equal(JSON.parse(readFileSync(directory+'/registration.json','utf8')).subject,'original-subject');
  if(callback)await assert.rejects(fetch(callback));
 }finally{auth.dispose();}
});

test('SIWC rejects wrong callback host/path before accepting the one-time valid callback',{timeout:10000},async()=>{
 const directory=mkdtempSync('.local/siwc-callback-'),cancel=new AbortController();let endpoint!:URL;
 const auth=new LocalSiwc({directory,request:async()=>Response.json({issuer:SIWC.issuer,authorization_endpoint:SIWC.authorize,token_endpoint:SIWC.token,jwks_uri:SIWC.jwks}),openBrowser:async(value)=>{
  endpoint=new URL(new URL(value).searchParams.get('redirect_uri')!);
  const wrongHostStatus=await new Promise<number>(resolve=>{const req=httpRequest(endpoint,{headers:{Host:'localhost:'+endpoint.port}},res=>{res.resume();resolve(res.statusCode!);});req.end();});
  assert.equal(wrongHostStatus,400);
  assert.equal((await fetch(new URL('/wrong-path',endpoint))).status,404);
  assert.equal((await fetch(endpoint,{method:'POST'})).status,400);
  cancel.abort();
 }});
 await assert.rejects(auth.signIn(cancel.signal),{message:'SIWC_CANCELLED'});
 assert.ok(!readdirSync(directory).includes('authorization.lock'));await assert.rejects(fetch(endpoint));
});
