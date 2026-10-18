import test from 'node:test';
import assert from 'node:assert/strict';
import {parseArtifact,type Artifact} from '../src/contracts.ts';
import {Store} from '../src/store.ts';
import {html,spec} from './helpers.ts';

function candidate(scope='full-html',profiles:unknown=[320,390,844]){
 return {html,method:'llm_code',provider:'offline-test',model:'authored',generationStatus:'succeeded',validationStatus:'passed',generation:{attempts:[{route:'primary',provider:'offline-test',requestedModel:'authored',model:'authored',outcome:'accepted',errorCode:null,elapsedMs:0}],fallback:false,elapsedMs:0,browser:{scope,profiles,offline:true,errors:0}}};
}

test('scope accepts current Full HTML and preserves historical two-profile evidence without promotion',()=>{
 for(const [scope,profiles] of [['startup-input-pause',[320,390]],['full-html',[320,390]],['full-html',[320,390,844]]] as const){
  const inputProfiles:number[]=[...profiles],input=candidate(scope,inputProfiles),parsed=parseArtifact(input);
  assert.deepEqual(parsed.generation!.browser.profiles,profiles);
  inputProfiles[0]=999;
  assert.deepEqual(parsed.generation!.browser.profiles,profiles);
  const store=new Store(':memory:');
  try{const saved=store.save(spec,parsed);assert.deepEqual(store.getVersion(saved.versionId),saved);}finally{store.close();}
 }
});

test('profile order, duplicates, unknown, missing and forged profiles fail closed for both scopes',()=>{
 const invalid:unknown[]=[[390,320],[320,390,390],[320,320],[320,390,845],[320,844,390],[320,390,844,844],[],[320],['320',390],[320,390,'844'],[320,390,null],{0:320,1:390,length:2}, {toJSON:()=>[320,390]},null];
 for(const scope of ['startup-input-pause','full-html'])for(const profiles of invalid){
  const value=candidate(scope,profiles);
  assert.throws(()=>parseArtifact(value),{message:'INVALID_GENERATION_METADATA'});
  const store=new Store(':memory:');
  try{assert.throws(()=>store.save(spec,value as Artifact),{message:'INVALID_GENERATION_METADATA'});assert.equal(store.list().length,0);}finally{store.close();}
 }
 assert.throws(()=>parseArtifact(candidate('startup-input-pause',[320,390,844])),{message:'INVALID_GENERATION_METADATA'});
 assert.throws(()=>parseArtifact(candidate('invented')),{message:'INVALID_GENERATION_METADATA'});
});
