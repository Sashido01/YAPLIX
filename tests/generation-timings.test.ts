import test from 'node:test';
import assert from 'node:assert/strict';
import {parseArtifact} from '../src/contracts.ts';
import {html} from './helpers.ts';

function candidate(value:number,field:string){
 const attempt={route:'primary',provider:'offline',requestedModel:'authored',model:'authored',outcome:'accepted',errorCode:null,elapsedMs:0,requestMs:0,validationMs:0};
 const browser={scope:'full-html',profiles:[320,390,844],offline:true,errors:0,elapsedMs:0};
 const generation={attempts:[attempt],fallback:false,elapsedMs:0,browser};
 if(field==='generation')generation.elapsedMs=value;
 else if(field==='browser')browser.elapsedMs=value;
 else attempt[field as 'elapsedMs'|'requestMs'|'validationMs']=value;
 return {html,method:'llm_code',provider:'offline',model:'authored',generationStatus:'succeeded',validationStatus:'passed',generation};
}

for(const field of ['generation','elapsedMs','requestMs','validationMs','browser']){
 for(const minutes of [0,5,29,30,35])test(`metadata ${field} accepts ${minutes} minutes without changing historical profiles`,()=>{
  const input=candidate(minutes*60_000,field);
  assert.deepEqual(parseArtifact(input).generation,input.generation);
  input.generation.browser.profiles=[320,390];
  assert.deepEqual(parseArtifact(input,'saved-metadata').generation,input.generation);
  assert.throws(()=>parseArtifact(input),/INVALID_GENERATION_METADATA/);
 });
 test(`metadata ${field} rejects invalid or over-budget timings`,()=>{
  for(const value of [-1,35*60_000+1,Number.MAX_SAFE_INTEGER+1,Infinity,-Infinity,NaN,1.5])
   for(const source of ['generation','saved-metadata'] as const)
    assert.throws(()=>parseArtifact(candidate(value,field),source),/INVALID_GENERATION_METADATA/);
 });
}
