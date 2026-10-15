import{test}from'node:test';
import assert from'node:assert/strict';
import{Store}from'../src/store.ts';
import{GenerationJobs}from'../src/jobs.ts';
import{GenerationEngine}from'../src/live.ts';
import{Fault}from'../src/contracts.ts';
import{html,spec}from'./helpers.ts';

test('exhausted repair budget preserves the actual rejection without dispatching again',async()=>{
 const store=new Store(':memory:');let calls=0;
 const engine=new GenerationEngine([{route:'primary',provider:'synthetic',model:'fixture',readiness:async()=>'ready',complete:async()=>{calls++;return{code:html,model:'fixture'};}}],{repairs:2,check:async()=>{throw new Fault('JAVASCRIPT_EXCEPTION');}});
 const jobs=new GenerationJobs(store,engine,undefined,true,{maxCalls:1});
 try{const made=jobs.create('owner','task011-error',{mode:'live',spec,telegramConsent:false});let job=jobs.get('owner',made.jobId);for(let i=0;i<100&&!['completed','needs_attention'].includes(job.stage);i++){await new Promise(r=>setTimeout(r,10));job=jobs.get('owner',made.jobId);}assert.equal(job.stage,'needs_attention');assert.equal(job.errorCode,'JAVASCRIPT_EXCEPTION');assert.equal(calls,1);assert.equal(job.attempts,1);assert.equal(store.list().length,0);assert.ok(job.checkpoint);}
 finally{await jobs.close();store.close();}
});
