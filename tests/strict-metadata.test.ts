import test from 'node:test';
import assert from 'node:assert/strict';
import {parseArtifact} from '../src/contracts.ts';
import {strictCanvas} from './strict-canvas-fixtures.ts';
const candidate={html:strictCanvas(),method:'llm_code',provider:'offline',model:'authored',generationStatus:'succeeded',validationStatus:'passed',generation:{attempts:[{route:'primary',provider:'offline',requestedModel:'authored',model:'authored',outcome:'accepted',errorCode:null,elapsedMs:0}],fallback:false,elapsedMs:0,browser:{scope:'full-html',profiles:[320,390,844],offline:true,errors:0}}};
test('new verified versions require strict evidence; saved history reads without promotion',()=>{
 assert.throws(()=>parseArtifact(candidate),/INVALID_GENERATION_METADATA/);
 assert.throws(()=>parseArtifact({...candidate,generation:undefined}),/INVALID_GENERATION_METADATA/);
 for(const rendering of [undefined,{contract:'canvas-webgl-v1',contexts:['2d'],profiles:[320,390,844]}]){
  const old={...candidate,generation:{...candidate.generation,browser:{...candidate.generation.browser,...(rendering?{rendering}:{})}}};
  assert.deepEqual(parseArtifact(old,'saved-metadata').generation?.browser.rendering,rendering);
  assert.throws(()=>parseArtifact(old),/INVALID_GENERATION_METADATA/);
 }
});
