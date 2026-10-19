import test from 'node:test';
import assert from 'node:assert/strict';
import {parseArtifact,type Artifact} from '../src/contracts.ts';
import {Store} from '../src/store.ts';
import {html,spec} from './helpers.ts';
import {GenerationEngine} from '../src/live.ts';
import {GenerationJobs} from '../src/jobs.ts';
import {createApp} from '../src/api.ts';
import {mkdtempSync} from 'node:fs';

function candidate(scope='full-html',profiles:unknown=[320,390,844]){
 return {html,method:'llm_code',provider:'offline-test',model:'authored',generationStatus:'succeeded',validationStatus:'passed',generation:{attempts:[{route:'primary',provider:'offline-test',requestedModel:'authored',model:'authored',outcome:'accepted',errorCode:null,elapsedMs:0}],fallback:false,elapsedMs:0,browser:{scope,profiles,offline:true,errors:0}}};
}

test('scope accepts current Full HTML and preserves historical two-profile evidence without promotion',()=>{
 for(const [scope,profiles] of [['startup-input-pause',[320,390]],['full-html',[320,390]],['full-html',[320,390,844]]] as const){
  const inputProfiles:number[]=[...profiles],input=candidate(scope,inputProfiles),historical=scope==='full-html'&&profiles.length===2;
  const parsed=parseArtifact(input,historical?'saved-metadata':'generation');
  assert.deepEqual(parsed.generation!.browser.profiles,profiles);
  inputProfiles[0]=999;
  assert.deepEqual(parsed.generation!.browser.profiles,profiles);
  const store=new Store(':memory:');
  try{
   if(historical)assert.throws(()=>store.save(spec,parsed),{message:'INVALID_GENERATION_METADATA'});
   else{const saved=store.save(spec,parsed);assert.deepEqual(store.getVersion(saved.versionId),saved);}
  }finally{store.close();}
 }
});

test('profile order, duplicates, unknown, missing and forged profiles fail closed for both scopes',()=>{
 const invalid:unknown[]=[[390,320],[320,390,390],[320,320],[320,390,845],[320,844,390],[320,390,844,844],[],[320],['320',390],[320,390,'844'],[320,390,null],{0:320,1:390,length:2}, {toJSON:()=>[320,390]},null];
 for(const scope of ['startup-input-pause','full-html'])for(const profiles of invalid){
  const value=candidate(scope,profiles);
  assert.throws(()=>parseArtifact(value),{message:'INVALID_GENERATION_METADATA'});
  assert.throws(()=>parseArtifact(value,'saved-metadata'),{message:'INVALID_GENERATION_METADATA'});
  const store=new Store(':memory:');
  try{assert.throws(()=>store.save(spec,value as Artifact),{message:'INVALID_GENERATION_METADATA'});assert.equal(store.list().length,0);}finally{store.close();}
 }
 assert.throws(()=>parseArtifact(candidate('startup-input-pause',[320,390,844])),{message:'INVALID_GENERATION_METADATA'});
 assert.throws(()=>parseArtifact(candidate('invented')),{message:'INVALID_GENERATION_METADATA'});
 assert.throws(()=>parseArtifact(candidate('full-html',[320,390])),{message:'INVALID_GENERATION_METADATA'});
});

test('local metadata fault preserves job response and never dispatches fallback or repair',async()=>{
 let calls=0;
 const route=(name:'primary'|'secondary')=>({route:name,provider:'offline-'+name,model:'authored',readiness:async()=>'ready',complete:async()=>{calls++;return{code:html,model:'authored'};}});
 // Fault injection only: the successful integration uses the production checker.
 const engine=new GenerationEngine([route('primary'),route('secondary')],{allowLlmRepair:true,repairs:1,check:async()=>({profiles:[320,390,845],offline:true,errors:0,scope:'full-html'})});
 const path=mkdtempSync('.local/metadata-fault-')+'/test.sqlite';let store=new Store(path),jobs=new GenerationJobs(store,engine);
 const settled=async(id:string)=>{for(let n=0;n<100;n++){const job=jobs.get('owner',id);if(['completed','needs_attention','failed'].includes(job.stage))return job;await new Promise(r=>setTimeout(r,20));}throw Error('JOB_NOT_SETTLED');};
 try{
  const id=jobs.create('owner','metadata-fault',{spec,mode:'live',telegramConsent:false}).jobId;
  const failed=await settled(id);
  assert.equal(failed.errorCode,'INVALID_GENERATION_METADATA');assert.equal(failed.stage,'needs_attention');
  assert.equal(failed.checkpoint,html);assert.equal(failed.originalCheckpoint,html);
  assert.equal(failed.attempts,1);assert.equal(calls,1);assert.equal(failed.retryAt,null);assert.equal(store.list().length,0);
  const apiFailed=await(await createApp(store,engine,undefined,undefined,undefined,undefined,jobs).request('/api/jobs/'+id)).json();
  assert.equal(apiFailed.stage,'needs_attention');assert.equal(apiFailed.errorCode,'INVALID_GENERATION_METADATA');assert.equal(apiFailed.originalCheckpoint,html);
  await jobs.close();store.close();store=new Store(path);jobs=new GenerationJobs(store,engine);
  assert.equal(jobs.get('owner',id).stage,'needs_attention');assert.equal(calls,1);
  assert.equal(jobs.get('owner',id).originalCheckpoint,html);
  // Explicit local revalidation of the preserved complete checkpoint must also
  // stop on the contract fault, even when artifact repair is otherwise enabled.
  jobs.continue('owner',id);const retried=await settled(id);
  assert.equal(retried.errorCode,'INVALID_GENERATION_METADATA');assert.equal(retried.stage,'needs_attention');
  assert.equal(calls,1);assert.equal(retried.attempts,1);assert.equal(retried.originalCheckpoint,html);assert.equal(store.list().length,0);
 }finally{await jobs.close();engine.close();store.close();}
});
