import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,symlinkSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {OperationTrace} from '../scripts/operation-trace.mjs';
import {runInstallation,InstallError} from '../scripts/install-engine.mjs';
import {safeTrace} from '../src/generation-trace.ts';

const profile=()=>mkdtempSync(resolve(tmpdir(),'yaplix-operation-trace-'));

test('operation trace persists one correlated lifecycle with bounded allowlisted metadata',()=>{
 const root=profile(),operationId=randomUUID();
 try{
  const trace=new OperationTrace({dataRoot:root,operationId});
  const finish=trace.begin('startup','startup.database_opened',{schemaVersion:3,nodeVersion:'v24.22.1'});
  finish('PASS',null,{integrity:true,apiKey:'never-log-this'});
  trace.linkJob(randomUUID());
  const file=resolve(root,'diagnostics/operations',operationId+'.jsonl');
  const rows=readFileSync(file,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(rows.length,3);
  assert.ok(rows.every((row:any)=>row.operationId===operationId));
  assert.equal(rows[0].status,'STARTED');assert.equal(rows[1].status,'PASS');
  assert.equal(rows[1].durationMs>=0,true);assert.equal(rows[1].details.schemaVersion,3);
  assert.equal('apiKey' in rows[1].details,false);assert.equal(rows[2].event,'generation.job_linked');
  assert.equal(statSync(file).mode&0o777,0o600);
  assert.equal(statSync(resolve(root,'diagnostics/operations')).mode&0o777,0o700);
  const restarted=new OperationTrace({dataRoot:root,operationId});
  restarted.record('startup','startup.completed','PASS');
  assert.equal(readFileSync(file,'utf8').trim().split('\n').length,4);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('installer trace records backup, update and verified rollback phases',async()=>{
 const root=profile(),operationId=randomUUID();
 try{
  const trace=new OperationTrace({dataRoot:root,operationId});
  const adapter={dataHome:root,check:async()=>({supported:true,integrity:true,dataIntegrity:true,writable:true,freeBytes:10_000_000_000,requiredBytes:1,needsNetwork:false,currentSame:false,installedVersion:'1.0',dependencies:['browser'],platform:'linux',architecture:'x64'}),recover:async()=>false,prepare:async()=>({rollback:true,backupCreated:true}),install:async()=>{},verify:async()=>({apiReady:true,uiReady:true,sandboxReady:true}),launch:async()=>({url:'http://127.0.0.1:3000/'}),commit:async()=>{}};
  await runInstallation(adapter,()=>{},trace);
  let rows=readFileSync(resolve(root,'diagnostics/operations',operationId+'.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.ok(rows.some(row=>row.event==='install.backup_ready'&&row.details.backupCreated===true));
  assert.ok(rows.some(row=>row.event==='install.installed'&&row.status==='PASS'));
  assert.ok(rows.some(row=>row.event==='install.completed'&&row.status==='PASS'));
  const failedId=randomUUID(),failed=new OperationTrace({dataRoot:root,operationId:failedId}),calls:string[]=[];
  await assert.rejects(runInstallation({...adapter,install:async()=>{throw new InstallError('VERIFY');},rollback:async()=>calls.push('rollback')},()=>{},failed),/VERIFY/);
  assert.deepEqual(calls,['rollback']);
  rows=readFileSync(resolve(root,'diagnostics/operations',failedId+'.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.ok(rows.some(row=>row.event==='install.rollback_started'));
  assert.ok(rows.some(row=>row.event==='install.rolled_back'&&row.status==='PASS'));
  assert.ok(rows.some(row=>row.event==='install.failed'&&row.status==='FAIL'&&row.errorCode==='VERIFY'));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('operation trace rotates its own bounded file and never throws when the private path is unsafe',()=>{
 const root=profile(),outside=profile(),operationId=randomUUID();
 try{
  const trace=new OperationTrace({dataRoot:root,operationId});
  for(let i=0;i<1200;i++)trace.record('startup','startup.runtime','PASS',{durationMs:i});
  const dir=resolve(root,'diagnostics/operations');
  assert.ok(readdirSync(dir).includes(operationId+'.jsonl.1'));
  const file=resolve(dir,operationId+'.jsonl');assert.ok(statSync(file).size<=131072);
  const link=resolve(root,'linked');symlinkSync(outside,link);
  const unavailable=new OperationTrace({dataRoot:link,operationId:randomUUID()});
  assert.equal(unavailable.record('startup','startup.failed','FAIL',{errorCode:'TRACE_PATH_INVALID'}),false);
  const danglingId=randomUUID(),danglingFile=resolve(dir,danglingId+'.jsonl');symlinkSync(resolve(root,'missing-target'),danglingFile);
  assert.equal(trace.record('startup','startup.failed','FAIL',{errorCode:'TRACE_PATH_INVALID'}),true);
  assert.equal(new OperationTrace({dataRoot:root,operationId:danglingId}).record('startup','startup.failed','FAIL',{errorCode:'TRACE_PATH_INVALID'}),false);
 }finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});

test('generation trace inherits a valid operation id but discards an invalid one',()=>{
 const before=process.env.YAPLIX_OPERATION_ID,id=randomUUID(),jobId=randomUUID();
 try{
  process.env.YAPLIX_OPERATION_ID=id;assert.equal((safeTrace('job.created',jobId) as any).operationId,id);
  process.env.YAPLIX_OPERATION_ID='not-a-uuid';assert.equal('operationId' in (safeTrace('job.created',jobId) as any),false);
 }finally{if(before===undefined)delete process.env.YAPLIX_OPERATION_ID;else process.env.YAPLIX_OPERATION_ID=before;}
});

test('browser phase diagnostics persist bounded durations and explicit skipped reasons only',()=>{
 const jobId=randomUUID();
 const started=safeTrace('browser.phase.started',jobId,{status:'STARTED',details:{phase:'render',phaseIndex:2,viewport:'320x700',html:'private html'}});
 const skipped=safeTrace('browser.phase.completed',jobId,{status:'SKIPPED',durationMs:37,errorCode:'YAPLIX_BRIDGE_NOT_OBSERVED',details:{phase:'bridge-handshake',phaseIndex:3,viewport:'320x700',reasonCode:'NO_GAME_READY_EVENT',prompt:'private prompt'}});
 const routed=safeTrace('browser.validator_routed',jobId,{status:'PASS',details:{phase:'full-html',reasonCode:'NO_GAME_READY_EVENT'}});
 const startedDetails=started.details as Record<string,unknown>,skippedDetails=skipped.details as Record<string,unknown>,routedDetails=routed.details as Record<string,unknown>;
 assert.equal(started.status,'STARTED');assert.equal(startedDetails.phase,'render');assert.equal('html' in startedDetails,false);
 assert.equal(skipped.status,'SKIPPED');assert.equal(skipped.durationMs,37);assert.equal(skipped.errorCode,'YAPLIX_BRIDGE_NOT_OBSERVED');
 assert.equal(skippedDetails.reasonCode,'NO_GAME_READY_EVENT');assert.equal('prompt' in skippedDetails,false);
 assert.equal(routedDetails.phase,'full-html');
 const viewport=safeTrace('browser.viewport.completed',jobId,{status:'FAIL',details:{canvasSampling:[{id:1,context:'2d',width:256,height:162,colorBuckets:4,significantColors:3,largestColorPixels:40000,html:'private html'}]}});
 assert.deepEqual((viewport.details as Record<string,unknown>).canvasSampling,[{id:1,context:'2d',width:256,height:162,colorBuckets:4,significantColors:3,largestColorPixels:40000}]);
});
