import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validationOutcome} from '../src/validation.ts';
import type {ValidationDiagnostic} from '../src/validation.ts';
import {GenerationEngine} from '../src/live.ts';
import {Fault} from '../src/contracts.ts';
import {html,spec} from './helpers.ts';

test('MICRO-028 technical success, missing evidence, game defect and checker failure remain distinct',()=>{
 assert.equal(validationOutcome(), 'NOT_VERIFIED');
 assert.equal(validationOutcome(undefined,[{level:'VERIFIED'}]),'NOT_VERIFIED');
 assert.equal(validationOutcome(undefined,Array.from({length:6},()=>({level:'VERIFIED'}))),'VERIFIED');
 assert.equal(validationOutcome(undefined,[...Array.from({length:5},()=>({level:'VERIFIED' as const})),{level:'NOT_VERIFIED'}]),'NOT_VERIFIED');
 for(const code of ['BROWSER_CHECK_INCONCLUSIVE','BROWSER_TIMEOUT_INTERACTION','REQUEST_CANCELLED'])assert.equal(validationOutcome(code),'NOT_VERIFIED');
 for(const code of ['BROWSER_CHECKER_ERROR','BROWSER_INSTALL_REQUIRED','BROWSER_SANDBOX_UNAVAILABLE','BROWSER_STARTUP_FAILED'])assert.equal(validationOutcome(code),'CHECKER_ERROR');
 for(const code of ['JAVASCRIPT_EXCEPTION','BROWSER_RESTART_FAILED','BROWSER_GAME_AREA'])assert.equal(validationOutcome(code),'FAILED');
});

test('MICRO-028 checker failure retains compatible NOT_VERIFIED, phase, checkpoint and never repairs',async()=>{
 for(const recovery of [false,true]){
  let calls=0,repairs=0;const diagnostics:ValidationDiagnostic[]=[],originals:string[]=[];
  const engine=new GenerationEngine([{route:'primary',provider:'ollama.com',model:'gemma4:31b',readiness:async()=>'ready',complete:async()=>{calls++;return{code:html,model:'gemma4:31b'};}}],{repairs:1,allowLlmRepair:true,check:async()=>{throw Object.assign(new Fault('BROWSER_CHECKER_ERROR',503),{validationPhase:'touch-input'});}});
  await assert.rejects(engine.generate(spec,undefined,undefined,undefined,{providerMode:'ollama-cloud',...(recovery?{checkpoint:html,checkpointOrigin:{provider:'ollama.com',requestedModel:'gemma4:31b',model:'gemma4:31b'}}:{}),stage(){},dispatch(){},attempt(){},partial(){},preserveOriginal(s){originals.push(s);},validation(d){diagnostics.push(d);},claimRepair(){repairs++;}}),/BROWSER_CHECKER_ERROR/);
  assert.equal(calls,recovery?0:1);assert.equal(repairs,0);assert.equal(originals.at(-1),html);
  assert.deepEqual(diagnostics.at(-1),{level:'NOT_VERIFIED',outcome:'CHECKER_ERROR',code:'BROWSER_CHECKER_ERROR',phase:'touch-input',feedback:'BROWSER_CHECKER_ERROR'});
 }
});
