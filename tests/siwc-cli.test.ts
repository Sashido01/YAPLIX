import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync} from 'node:fs';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import * as cli from '../scripts/siwc-auth.ts';
import {SIWC} from '../src/experimental/siwc.ts';

const keys=await generateKeyPair('RS256');
const jwk={...await exportJWK(keys.publicKey),kid:'cli-offline',alg:'RS256',use:'sig'};
const scopes='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';

async function exerciseCli(kind='completed',loopback=false){
 const stdout:string[]=[],stderr:string[]=[],directory=mkdtempSync('.local/siwc-cli-test-');
 let authorization!:URL,posts=0,refreshes=0,tokenPosts=0,modelsGets=0,cancelled=false;
 const request:typeof fetch=async(input,init)=>{
  const url=String(input);
  if(url===SIWC.discovery)return Response.json({issuer:SIWC.issuer,authorization_endpoint:SIWC.authorize,token_endpoint:SIWC.token,jwks_uri:SIWC.jwks});
  if(url===SIWC.jwks)return Response.json({keys:[jwk]});
  if(url===SIWC.token){
   tokenPosts++;
   const form=new URLSearchParams(String(init?.body));
   if(form.get('grant_type')==='refresh_token')refreshes++;
   assert.equal(form.get('grant_type'),'authorization_code');
   const token=await new SignJWT({nonce:authorization.searchParams.get('nonce')}).setProtectedHeader({alg:'RS256',kid:'cli-offline'}).setIssuer(SIWC.issuer).setAudience('oaiapp_cli_offline').setSubject('cli-offline-subject').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
   return Response.json({access_token:'CLI_ACCESS_SECRET',refresh_token:'CLI_REFRESH_SECRET',id_token:token,token_type:'Bearer',expires_in:kind==='expired'?1:3600,scope:scopes});
  }
  if(url==='https://api.openai.com/v1/models'){
   modelsGets++;assert.equal(init?.method,'GET');
   if(kind==='expired')await new Promise(resolve=>setTimeout(resolve,1100));
   return Response.json({models:[{slug:kind==='other-model'?'gpt-6-astra':kind==='pro-only'?'gpt-6.1-sol-pro':'gpt-6.1-sol',display_name:'GPT',visibility:kind==='hidden'?'hide':'list'}]});
  }
  assert.equal(url,'https://api.openai.com/v1/responses');posts++;
  assert.deepEqual(JSON.parse(String(init?.body)),{model:'gpt-6.1-sol',input:[{role:'user',content:'Ответь точно: YAPLIX READY'}],store:false,stream:true,reasoning:{effort:'medium'}});
  assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error');
  if(/^http-/.test(kind))return new Response('RAW_HTTP_SECRET',{status:Number(kind.slice(5))});
  if(kind==='timeout')return new Response(new ReadableStream({cancel(){cancelled=true;}}));
  if(kind==='failed')return new Response('data: {"type":"response.failed","response":{"status":"failed","error":{"code":"server_error","message":"RAW_ERROR_SECRET"}}}\n\n');
  if(kind==='incomplete')return new Response('data: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}\n\n');
  if(kind==='error')return new Response('data: {"type":"error","code":"invalid_request_error","message":"RAW_ERROR_SECRET"}\n\n');
  if(kind==='interrupted')return new Response('data: {"type":"response.output_text.delta","delta":"RAW_ANSWER_SECRET"}\n\n');
  if(kind==='empty')return new Response('data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n');
  if(kind==='malformed')return new Response('data: {RAW_SSE_SECRET}\n\n');
  if(kind==='http200-only')return new Response('RAW_HTTP_SECRET');
  return new Response('data: {"type":"response.output_text.done","text":"YAPLIX READY"}\n\ndata: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n');
 };
 // Real local HTTP/SSE boundary, never an OpenAI connection. The router only
 // serves the two pinned API paths; discovery/token/JWKS remain synthetic.
 const server=createServer(async(req,res)=>{
  try{
   if(req.url!=='/v1/models'&&req.url!=='/v1/responses'){res.writeHead(404);res.end();return;}
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
   const body=Buffer.concat(chunks).toString('utf8');
   const response=await request('https://api.openai.com'+req.url,{method:req.method,headers:req.headers as Record<string,string>,redirect:'error',...(body?{body}:{})});
   res.writeHead(response.status,Object.fromEntries(response.headers));
   if(response.body)for await(const chunk of response.body as unknown as AsyncIterable<Uint8Array>)res.write(chunk);
   res.end();
  }catch{res.destroy();}
 });
 let localOrigin='';
 if(loopback){await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));localOrigin='http://127.0.0.1:'+(server.address() as {port:number}).port;}
 const route:typeof fetch=async(input,init)=>{
  const url=String(input);
  if(loopback&&(url==='https://api.openai.com/v1/models'||url==='https://api.openai.com/v1/responses'))return fetch(localOrigin+new URL(url).pathname,init);
  return request(input,init);
 };
 let code:number;
 try{code=await cli.runSiwcCli(['--probe'],{probeTimeoutMs:kind==='timeout'?100:5000,stdout:value=>stdout.push(value),stderr:value=>stderr.push(value),authOptions:{directory,request:route,openBrowser:async value=>{
  authorization=new URL(value);const callback=new URL(authorization.searchParams.get('redirect_uri')!);
  callback.search=new URLSearchParams({state:authorization.searchParams.get('state')!,code:'CLI_CODE_SECRET',client_id:'oaiapp_cli_offline'}).toString();
  assert.equal((await fetch(callback)).status,200);
 }}});}finally{
  if(loopback){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
 }
 assert.equal(stdout.length,1);const report=JSON.parse(stdout[0]);
 assert.equal(modelsGets,1);assert.equal(tokenPosts,1);assert.equal(refreshes,0);assert.ok(posts<=1);
 const output=stdout.concat(stderr).join('\n')+readdirSync(directory).map(file=>readFileSync(directory+'/'+file,'utf8')).join('');
 for(const secret of ['CLI_ACCESS_SECRET','CLI_REFRESH_SECRET','CLI_CODE_SECRET','YAPLIX READY','data:','RAW_HTTP_SECRET','RAW_ERROR_SECRET','RAW_ANSWER_SECRET','RAW_SSE_SECRET','code_verifier','Authorization','Bearer','id_token'])assert.ok(!output.includes(secret));
 assert.ok(!/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(output));
 assert.deepEqual(readdirSync(directory).sort(),['host.json','registration.json']);
 assert.equal(report.requestedReasoningEffort,'medium');
 return{code,report,posts,cancelled};
}

test('SIWC CLI emits updated completed diagnostics and permits exactly one Responses POST',async()=>{
 const {code,report,posts}=await exerciseCli();
 assert.equal(code,0);assert.equal(report.result,'PASS');assert.equal(report.inference,'COMPLETED');assert.equal(report.diagnostics.textLength,12);
 assert.deepEqual(report.diagnostics.eventCounts,{'response.output_text.done':1,'response.completed':1});
 assert.equal(posts,1);assert.deepEqual(report.providerCalls,{modelsGet:1,inferencePost:1});
});

for(const [kind,outcome,error,posts] of [
 ['failed','FAILED','SIWC_INFERENCE_FAILED',1],['incomplete','INCOMPLETE','SIWC_INFERENCE_INCOMPLETE',1],
 ['error','ERROR','SIWC_INFERENCE_FAILED',1],['interrupted','INTERRUPTED','SIWC_STREAM_INTERRUPTED',1],
 ['empty','COMPLETED_EMPTY','SIWC_COMPLETED_WITHOUT_TEXT',1],['malformed','INVALID_SSE','SIWC_SSE_INVALID',1],
 ['http200-only','ATTEMPTED','SIWC_SSE_REQUIRED',1],
 ['http-401','ATTEMPTED','SIWC_INFERENCE_HTTP',1],['http-429','ATTEMPTED','SIWC_INFERENCE_HTTP',1],
 ['http-500','ATTEMPTED','SIWC_INFERENCE_HTTP',1],['http-503','ATTEMPTED','SIWC_INFERENCE_HTTP',1],
 ['timeout','ATTEMPTED','SIWC_PROBE_CANCELLED',1],
 ['expired','NOT_RUN','SIWC_PLAN_PERMISSION_REQUIRED',0],
 ['other-model','NOT_RUN','SIWC_PROBE_MODEL_UNAVAILABLE',0],['pro-only','NOT_RUN','SIWC_PROBE_MODEL_UNAVAILABLE',0],
 ['hidden','NOT_RUN','SIWC_PROBE_MODEL_UNAVAILABLE',0],
] as const)test('SIWC CLI fails closed without retry, refresh or leaks: '+kind,async()=>{
 const actual=await exerciseCli(kind);
 assert.equal(actual.code,1);assert.equal(actual.report.result,'PARTIAL');assert.equal(actual.report.inference,outcome);assert.equal(actual.report.error,error);
 assert.equal(actual.posts,posts);assert.deepEqual(actual.report.providerCalls,{modelsGet:1,inferencePost:posts});
 if(kind==='timeout')assert.equal(actual.cancelled,true);
 if(kind.startsWith('http-'))assert.equal(actual.report.httpStatus,Number(kind.slice(5)));
});

test('the exact source CLI executable rejects extra arguments before OAuth',()=>{
 const result=spawnSync(process.execPath,['scripts/siwc-auth.ts','--probe','--unexpected'],{encoding:'utf8',timeout:5000,windowsHide:true});
 assert.equal(result.status,2);assert.equal(result.stdout,'');assert.match(result.stderr,/^Usage:/);
});

for(const [kind,outcome,code] of [['completed','COMPLETED',0],['failed','FAILED',1],['incomplete','INCOMPLETE',1],['error','ERROR',1],['interrupted','INTERRUPTED',1]] as const)test('SIWC source CLI runner with a real loopback HTTP/SSE server: '+kind,async()=>{
 const actual=await exerciseCli(kind,true);
 assert.equal(actual.code,code);assert.equal(actual.report.inference,outcome);
 assert.equal(actual.posts,1);assert.deepEqual(actual.report.providerCalls,{modelsGet:1,inferencePost:1});
 assert.equal(actual.report.result,code===0?'PASS':'PARTIAL');
 assert.ok(actual.report.diagnostics.receivedBytes>0);
});
