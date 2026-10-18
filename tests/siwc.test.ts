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
