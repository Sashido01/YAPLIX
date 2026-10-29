import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { GenerationEngine, configuredGenerator } from '../src/live.ts';
import { GenerationJobs } from '../src/jobs.ts';
import { Store } from '../src/store.ts';
import { BrowserFailure } from '../src/browser-check.ts';
import { Fault, parseArtifact } from '../src/contracts.ts';
import { prepareDocument } from '../src/validation.ts';
import { CloudOutputFailure } from '../src/transport.ts';
import type { CodeTransport, GenerationContext } from '../src/transport.ts';
import { html, spec } from './helpers.ts';

const evidence=async()=>({rendering:{contract:'canvas-webgl-strict-v2' as const,contexts:['2d' as const],profiles:[320,390,844]},profiles:[320,390],offline:true as const,errors:0 as const,scope:'startup-input-pause' as const});
const route=(complete:CodeTransport['complete']):CodeTransport=>({route:'primary',provider:'ollama.com',model:'gemma4:31b',readiness:async()=>'ready',complete});
async function settled(jobs:GenerationJobs,id:string){for(let i=0;i<300;i++){const job=jobs.get('owner',id);if(['completed','needs_attention','cancelled'].includes(job.stage))return job;await new Promise(r=>setTimeout(r,10));}throw Error('TEST_JOB_TIMEOUT');}

test('deterministic repairs preserve every script byte and reject ambiguous/incomplete formats',()=>{
  const bare=html.trim().replace(/^<!DOCTYPE html>\s*/,''),json=JSON.stringify(html.trim());
  assert.deepEqual(prepareDocument(bare),{html:'<!DOCTYPE html>\n'+bare,repair:'MISSING_DOCTYPE'});
  assert.deepEqual(prepareDocument(json),{html:html.trim(),repair:'JSON_STRING_DOCUMENT'});
  for(const raw of ['broken',JSON.stringify({html}),JSON.stringify(html+html),'<html>truncated',html+html,'<html><html></html>'])assert.throws(()=>prepareDocument(raw),/LLM_INVALID_HTML/);
  const typo=html.replace('id="score"','data-yaplix-state" id="score"');assert.equal(prepareDocument(typo).html,typo.trim());
});

for(const format of ['doctype','json'])test('format repair is revalidated and persists one version with durable original: '+format,async()=>{
  const raw=format==='json'?JSON.stringify(html.trim()):html.trim().replace(/^<!DOCTYPE html>\s*/,'');let calls=0,checks=0;
  const store=new Store(':memory:'),engine=new GenerationEngine([route(async()=>{calls++;return{code:raw,model:'gemma4:31b'};})],{check:async code=>{checks++;assert.equal(code,prepareDocument(raw).html);return evidence();}}),jobs=new GenerationJobs(store,engine);
  try{
    const id=jobs.create('owner','format-case-'+format,{spec,mode:'live',telegramConsent:false}).jobId,done=await settled(jobs,id);
    assert.equal(done.stage,'completed');assert.equal(calls,1);assert.equal(checks,1);assert.equal(done.originalCheckpoint,raw);assert.equal(done.validation?.level,'VERIFIED');
    assert.equal(store.history(done.gameId!).length,1);assert.equal(store.getVersion(done.versionId!).html,prepareDocument(raw).html);
    assert.ok(!('originalCheckpoint' in jobs.summary(done)));assert.ok(!('checkpoint' in jobs.summary(done)));
  }finally{await jobs.close();store.close();}
});

test('confirmed sandbox storage failure repairs on the same route, revalidates, and saves once',async()=>{
  const original=html.replace('draw();','throw Error("startup defect");');let calls=0,checks=0,secondary=0;
  const primary=route(async messages=>{calls++;if(calls===2){assert.ok(messages.at(-1)!.content.includes('BROWSER_STORAGE_ACCESS_FORBIDDEN'));assert.ok(messages.at(-1)!.content.includes('keep game state in JavaScript memory'));assert.equal(messages.at(-2)!.content.trimEnd(),original.trimEnd());}return{code:calls===1?original:html,model:'gemma4:31b'};});
  const storageDefect='Generated game attempted forbidden persistent browser storage (localStorage). Games run in an opaque-origin sandboxed iframe; remove this dependency and keep game state in JavaScript memory.';
  const store=new Store(':memory:'),jobs=new GenerationJobs(store,new GenerationEngine([primary,{...route(async()=>{secondary++;return{code:html,model:'other'};}),provider:'openrouter',model:'openrouter/free',route:'secondary'}],{repairs:2,check:async()=>{if(++checks===1)throw new BrowserFailure('BROWSER_STORAGE_ACCESS_FORBIDDEN',storageDefect);return evidence();}}));
  try{
    const request={spec,mode:'live' as const,telegramConsent:false},id=jobs.create('owner','mock-repair-idempotent',request).jobId,done=await settled(jobs,id);
    assert.equal(done.stage,'completed');assert.equal(calls,2);assert.equal(checks,2);assert.equal(secondary,0);assert.equal(done.repairUsed,true);assert.equal(done.repairCount,1);assert.equal(done.originalCheckpoint,original);assert.equal(done.checkpoint,html);assert.equal(done.history[0].errorCode,'BROWSER_STORAGE_ACCESS_FORBIDDEN');assert.equal(done.validation?.level,'VERIFIED');
    assert.equal(jobs.create('owner','mock-repair-idempotent',request).versionId,done.versionId);assert.equal(store.history(done.gameId!).length,1);assert.equal(store.getVersion(done.versionId!).html.trimEnd(),html.trimEnd());
  }finally{await jobs.close();store.close();}
});

test('Ollama Cloud honors the configured two-repair ceiling and preserves a failed draft without saving',async()=>{
  const first=html.replace('draw();','throw Error("original defect");'),second=html.replace('draw();','draw();/* incomplete repair */');
  const messagesSeen:Array<{role:string;content:string}[]> = [];let calls=0,checks=0;
  const primary=route(async messages=>{messagesSeen.push(structuredClone(messages));calls++;return{code:calls===1?first:second,model:'gemma4:31b'};});
  const store=new Store(':memory:'),engine=new GenerationEngine([primary],{repairs:2,allowLlmRepair:true,check:async()=>{checks++;throw new BrowserFailure(checks===1?'JAVASCRIPT_EXCEPTION':'BROWSER_INPUT_NO_EFFECT',checks===1?'original browser exception':'repair still has no working input');}}),jobs=new GenerationJobs(store,engine);
  try{
    assert.equal(engine.repairLimit,2);
    const id=jobs.create('owner','one-repair-bound',{spec,mode:'live',providerMode:'ollama-cloud',telegramConsent:false}).jobId,done=await settled(jobs,id);
    assert.equal(done.stage,'needs_attention');assert.equal(calls,3);assert.equal(checks,3);assert.equal(done.repairCount,2);assert.equal(done.repairUsed,true);
    assert.equal(messagesSeen[1].at(-2)?.content,first);assert.match(messagesSeen[1].at(-1)?.content??'',/JAVASCRIPT_EXCEPTION/);assert.ok(messagesSeen[1].some(message=>message.role==='user'&&message.content.includes(spec.prompt)));assert.ok(messagesSeen[1].some(message=>message.role==='assistant'&&message.content===first));
    assert.equal(done.originalCheckpoint,first);assert.equal(done.checkpoint,second);assert.equal(store.list().length,0);
  }finally{await jobs.close();store.close();}
});

test('configured Ollama repair ceiling defaults to three and accepts only zero through three',()=>{
  const engine=(repairs?:string)=>configuredGenerator({LIVE_PROVIDER:'ollama-cloud',OLLAMA_CLOUD_API_KEY:'synthetic',...(repairs===undefined?{}:{LLM_REPAIRS:repairs})})!;
  assert.equal(engine().repairLimit,3);assert.equal(engine('0').repairLimit,0);assert.equal(engine('2').repairLimit,2);assert.equal(engine('3').repairLimit,3);
  assert.throws(()=>engine('4'),/INVALID_LLM_CONFIGURATION/);
});

test('an interrupted repair is not resent after automatic retry, SQLite reopen, or Continue',async()=>{
  const path='.local/tests/micro022-inflight-'+randomUUID()+'.sqlite';let calls=0,checks=0;
  const engine=new GenerationEngine([route(async()=>{if(++calls===1)return{code:html,model:'gemma4:31b'};throw new Fault('LLM_HTTP',503);})],{check:async()=>{checks++;throw new BrowserFailure('JAVASCRIPT_EXCEPTION','same original browser failure');}});
  let store=new Store(path),jobs=new GenerationJobs(store,engine,undefined,true,{retryMs:10});let id='';
  try{
    id=jobs.create('owner','repair-inflight-no-replay',{spec,mode:'live',providerMode:'ollama-cloud',telegramConsent:false}).jobId;const failed=await settled(jobs,id);
    assert.equal(failed.stage,'needs_attention');assert.equal(failed.repairCount,1);assert.equal(failed.repairInFlight,true);assert.equal(calls,2);assert.equal(failed.originalCheckpoint,html);assert.equal(store.list().length,0);
  }finally{await jobs.close();store.close();}
  store=new Store(path);jobs=new GenerationJobs(store,engine);
  try{
    assert.equal(jobs.get('owner',id).repairInFlight,true);jobs.continue('owner',id);const failed=await settled(jobs,id);
    assert.equal(failed.stage,'needs_attention');assert.equal(failed.errorCode,'JAVASCRIPT_EXCEPTION');assert.equal(calls,2);assert.equal(failed.repairCount,1);assert.equal(store.integrity(),true);
  }finally{await jobs.close();store.close();}
});

test('broken Ollama repair stops at the configured two-rewrite limit; drafts survive reopen and Continue',async()=>{
  const path='.local/tests/micro022-'+randomUUID()+'.sqlite';let calls=0;
  const engine=new GenerationEngine([route(async()=>({code:html.replace('</html>','<!-- attempt '+(++calls)+' --></html>'),model:'gemma4:31b'}))],{repairs:2,check:async()=>{throw new BrowserFailure('JAVASCRIPT_EXCEPTION','Cannot set properties of null');}});
  let store=new Store(path),jobs=new GenerationJobs(store,engine);let id='',original='';
  try{
    id=jobs.create('owner','bad-repair-durable',{spec,mode:'live',telegramConsent:false}).jobId;const failed=await settled(jobs,id);original=failed.originalCheckpoint!;
    assert.equal(failed.stage,'needs_attention');assert.equal(failed.errorCode,'JAVASCRIPT_EXCEPTION');assert.equal(calls,3);assert.equal(failed.repairUsed,true);assert.equal(failed.repairCount,2);assert.equal(failed.repairInFlight,false);assert.equal(failed.validation?.level,'FAILED');assert.equal(store.list().length,0);
  }finally{await jobs.close();store.close();}
  store=new Store(path);jobs=new GenerationJobs(store,engine);
  try{
    assert.equal(jobs.get('owner',id).originalCheckpoint,original);jobs.continue('owner',id);const failed=await settled(jobs,id);
    assert.equal(failed.stage,'needs_attention');assert.equal(calls,3);assert.equal(failed.errorCode,'JAVASCRIPT_EXCEPTION');assert.equal(failed.repairCount,2);assert.equal(store.integrity(),true);assert.equal(store.list().length,0);
  }finally{await jobs.close();store.close();}
});

test('a deterministic candidate failing browser checks never becomes Ready',async()=>{
  const raw=html.trim().replace(/^<!DOCTYPE html>\s*/,'');const store=new Store(':memory:');
  const jobs=new GenerationJobs(store,new GenerationEngine([route(async()=>({code:raw,model:'gemma4:31b'}))],{repairs:0,check:async()=>{throw new Fault('JAVASCRIPT_EXCEPTION');}}));
  try{const id=jobs.create('owner','format-still-broken',{spec,mode:'live',telegramConsent:false}).jobId,job=await settled(jobs,id);assert.equal(job.stage,'needs_attention');assert.equal(job.originalCheckpoint,raw);assert.equal(store.list().length,0);}finally{await jobs.close();store.close();}
});

test('router checkpoint defect never repairs or falls back even when a new primary is configured',async()=>{
  let primary=0,secondary=0,checks=0,claims=0;
  const secondaryRoute={...route(async()=>{secondary++;return{code:html,model:'actual-free'};}),provider:'openrouter',model:'openrouter/free',route:'secondary' as const};
  const engine=new GenerationEngine([route(async()=>{primary++;return{code:html,model:'gemma4:31b'};}),secondaryRoute],{check:async()=>{if(++checks===1)throw new BrowserFailure('JAVASCRIPT_EXCEPTION','checkpoint defect');return evidence();}});
  const context:GenerationContext={providerMode:'openrouter',checkpoint:html,checkpointOrigin:{provider:'openrouter',requestedModel:'openrouter/free',model:'actual-free'},stage:()=>{},dispatch:()=>{},partial:()=>{},attempt:()=>{},claimRepair:()=>{claims++;}};
  await assert.rejects(engine.generate(spec,undefined,'llm_code',undefined,context),/JAVASCRIPT_EXCEPTION/);
  assert.equal(primary,0);assert.equal(secondary,0);assert.equal(claims,0);assert.equal(checks,1);
});

test('a failed repair transport cannot turn provider fallback into another repair request',async()=>{
  let calls=0,backup=0;
  const primary=route(async()=>{if(++calls===2)throw new Fault('LLM_HTTP',503);return{code:html,model:'gemma4:31b'};});
  const secondary={...route(async()=>{backup++;return{code:html,model:'free'};}),provider:'openrouter',model:'openrouter/free',route:'secondary' as const};
  const engine=new GenerationEngine([primary,secondary],{check:async()=>{throw new BrowserFailure('JAVASCRIPT_EXCEPTION','fixture');}});
  await assert.rejects(engine.generate(spec),/LLM_HTTP/);assert.equal(calls,2);assert.equal(backup,0);
});

test('disabled cloud repair cannot rewrite an incomplete checkpoint through recovery',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('INFERENCE_FORBIDDEN');});
  const engine=configuredGenerator({OLLAMA_CLOUD_API_KEY:'synthetic',LLM_AUTO_REPAIR:'0'})!;
  const context:GenerationContext={checkpoint:'<!DOCTYPE html><html>draft',checkpointOrigin:{provider:'ollama.com',requestedModel:'gemma4:31b',model:'gemma4:31b'},stage:()=>{},dispatch:()=>{},partial:()=>{},attempt:()=>{}};
  await assert.rejects(engine.generate(spec,undefined,'llm_code',undefined,context),/LLM_INVALID_HTML/);assert.equal(calls,0);
});

for(const provenance of ['missing','removed'])test('unconfirmed checkpoint cannot dispatch a recovery request: '+provenance,async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('INFERENCE_FORBIDDEN');});
  const engine=configuredGenerator({OLLAMA_CLOUD_API_KEY:'synthetic'})!;
  const context:GenerationContext={checkpoint:'<!DOCTYPE html><html>draft',...(provenance==='removed'?{checkpointOrigin:{provider:'openrouter',requestedModel:'openrouter/free',model:'old-free'}}:{}),stage:()=>{},dispatch:()=>{},partial:()=>{},attempt:()=>{}};
  await assert.rejects(engine.generate(spec,undefined,'llm_code',undefined,context),/CHECKPOINT_ORIGIN_UNAVAILABLE/);assert.equal(calls,0);
});

test('incomplete last repair cannot bypass the durable cap on Continue or worker restart',async()=>{
  let calls=0;const path='.local/tests/micro022-incomplete-'+randomUUID()+'.sqlite';let store=new Store(path);
  const engine=new GenerationEngine([route(async()=>({code:++calls===1?html:'incomplete repaired document',model:'gemma4:31b'}))],{check:async()=>{throw new BrowserFailure('JAVASCRIPT_EXCEPTION','original defect');}});
  let jobs=new GenerationJobs(store,engine);let id='';
  try{id=jobs.create('owner','incomplete-repair',{spec,mode:'live',telegramConsent:false}).jobId;const bad=await settled(jobs,id);assert.equal(bad.errorCode,'LLM_INVALID_HTML');assert.equal(bad.automaticLimit,4);assert.equal(bad.repairBudget,3);assert.equal(bad.attempts,4);assert.equal(bad.repairCount,3);assert.equal(calls,4);assert.equal(bad.checkpoint,'incomplete repaired document');assert.throws(()=>jobs.continue('owner',id),/JOB_ATTEMPT_LIMIT/);assert.equal(calls,4);}finally{await jobs.close();store.close();}
  store=new Store(path);jobs=new GenerationJobs(store,engine);
  try{assert.throws(()=>jobs.continue('owner',id),/JOB_ATTEMPT_LIMIT/);const bad=jobs.get('owner',id);assert.equal(calls,4);assert.equal(bad.automaticLimit,4);assert.equal(bad.repairBudget,3);assert.equal(bad.originalCheckpoint,html);assert.equal(bad.errorCode,'LLM_INVALID_HTML');assert.equal(store.list().length,0);}finally{await jobs.close();store.close();}
});

test('truncated repair automatic retry preserves the original and cannot dispatch another repair',async()=>{
  const truncated='<!DOCTYPE html><html>';let calls=0,checks=0;
  const engine=new GenerationEngine([route(async()=>{if(++calls===1)return{code:html,model:'gemma4:31b'};throw new CloudOutputFailure('gemma4:31b',truncated);})],{check:async()=>{checks++;throw new BrowserFailure('JAVASCRIPT_EXCEPTION','original startup defect');}});
  const store=new Store(':memory:'),jobs=new GenerationJobs(store,engine,undefined,true,{retryMs:10});
  try{
    const id=jobs.create('owner','truncated-repair-auto',{spec,mode:'live',telegramConsent:false}).jobId,failed=await settled(jobs,id);
    assert.equal(failed.stage,'needs_attention');assert.equal(failed.automaticRuns,2);assert.equal(calls,2);assert.equal(failed.attempts,2);assert.equal(checks,1);
    assert.equal(failed.repairUsed,true);assert.equal(failed.originalCheckpoint,html);assert.equal(failed.checkpoint,truncated);assert.equal(failed.errorCode,'JAVASCRIPT_EXCEPTION');assert.equal(failed.validation?.level,'FAILED');
    assert.equal(failed.history.at(-1)?.errorCode,'LLM_OUTPUT_TRUNCATED');assert.equal(store.list().length,0);assert.equal(store.integrity(),true);
  }finally{await jobs.close();store.close();}
});

test('validation timeout is NOT_VERIFIED, consumes no repair, and preserves checkpoint',async()=>{
  let calls=0;const store=new Store(':memory:'),jobs=new GenerationJobs(store,new GenerationEngine([route(async()=>{calls++;return{code:html,model:'gemma4:31b'};})],{check:async()=>{throw new Fault('BROWSER_TIMEOUT_INTERACTION',504);}}));
  try{const id=jobs.create('owner','validation-timeout',{spec,mode:'live',telegramConsent:false}).jobId,job=await settled(jobs,id);assert.equal(job.stage,'needs_attention');assert.equal(job.validation?.level,'NOT_VERIFIED');assert.equal(calls,1);assert.equal(job.originalCheckpoint,html);assert.equal(job.repairUsed,undefined);assert.equal(store.list().length,0);}finally{await jobs.close();store.close();}
});

test('explicitly disabled cloud repair stops after the first inference dispatch',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({model:'gemma4:31b',choices:[{finish_reason:'stop',message:{content:html}}]});});
  const engine=configuredGenerator({OLLAMA_CLOUD_API_KEY:'synthetic',LLM_AUTO_REPAIR:'0'})!;
  // Keep the real CloudTransport and production policy; replace only the browser.
  (engine as unknown as {check:typeof evidence}).check=async()=>{throw new BrowserFailure('JAVASCRIPT_EXCEPTION','fixture');};
  await assert.rejects(engine.generate(spec),/JAVASCRIPT_EXCEPTION/);assert.equal(calls,1);
});

test('a repair cannot bypass cancellation or the request deadline',async()=>{
  let calls=0;const controller=new AbortController();
  const engine=new GenerationEngine([route(async(_m,signal)=>{if(++calls===1)return{code:html,model:'gemma4:31b'};return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));})],{timeoutMs:1000,check:async()=>{throw new BrowserFailure('JAVASCRIPT_EXCEPTION','fixture');}});
  await assert.rejects(engine.generate(spec),/LLM_TIMEOUT/);assert.equal(calls,2);
  calls=0;const pending=engine.generate(spec,undefined,'llm_code',controller.signal);setTimeout(()=>controller.abort(),30);await assert.rejects(pending,/REQUEST_CANCELLED/);assert.equal(calls,2);
});

test('persisted browser evidence rejects FAILED or invalid per-aspect claims',async()=>{
  const result=await new GenerationEngine([route(async()=>({code:html,model:'gemma4:31b'}))],{check:evidence}).generate(spec);
  assert.throws(()=>parseArtifact({...result,generation:{...result.generation,browser:{...result.generation!.browser,checks:[{aspect:'html-runs',level:'FAILED'}]}}}),/INVALID_GENERATION_METADATA/);
});
