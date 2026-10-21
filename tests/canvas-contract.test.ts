import test from 'node:test';
import assert from 'node:assert/strict';
import {generationMessages} from '../src/generation.ts';
import {Store} from '../src/store.ts';
import {parseArtifact,Fault} from '../src/contracts.ts';
import {GenerationEngine} from '../src/live.ts';
import {spec} from './helpers.ts';
import {canvasGame,domGame} from './canvas-fixtures.ts';

test('all prompt styles require Canvas/WebGL for new games and conversion of DOM edits',()=>{
 const store=new Store(':memory:');
 try{
  const old=store.save(spec,{html:domGame,method:'mock',provider:null,model:null,generationStatus:'succeeded',validationStatus:'unverified'});
  for(const style of ['direct','spec','intent'] as const)for(const previous of [undefined,old]){
   const messages=generationMessages({...spec,prompt:'Create a puzzle'},previous,style);
   assert.match(messages[0].content,/Render the game world and all gameplay objects/);
   assert.match(messages[0].content,/Render ALL visible game UI inside Canvas\/WebGL/);
   assert.match(messages[0].content,/Convert any existing DOM gameplay rendering/);
   assert.doesNotMatch(messages[0].content,/Choose Canvas or DOM/);
   if(previous){if(style==='intent')assert.equal(JSON.parse(messages[1].content).currentCompleteHtml,previous.html);else assert.ok(messages[1].content.includes(previous.html));}
  }
 }finally{store.close();}
});

test('render evidence survives metadata parsing; invalid evidence fails closed',()=>{
 const rendering={contract:'canvas-webgl-strict-v2',contexts:['2d'],profiles:[320,390,844]};
 const candidate={html:canvasGame(),method:'llm_code',provider:'offline',model:'authored',generationStatus:'succeeded',validationStatus:'passed',generation:{attempts:[{route:'primary',provider:'offline',requestedModel:'authored',model:'authored',outcome:'accepted',errorCode:null,elapsedMs:0}],fallback:false,elapsedMs:0,browser:{scope:'full-html',profiles:[320,390,844],offline:true,errors:0,rendering}}};
 assert.deepEqual(parseArtifact(candidate).generation?.browser.rendering,rendering);
 for(const invalid of [{...rendering,contexts:[]},{...rendering,contexts:['svg']},{...rendering,contexts:['2d','2d']},{...rendering,profiles:[320,390]},{...rendering,contract:'invented'}]){
  assert.throws(()=>parseArtifact({...candidate,generation:{...candidate.generation,browser:{...candidate.generation.browser,rendering:invalid}}}),/INVALID_GENERATION_METADATA/);
 }
});

test('generation metadata preserves a 29-minute response and bounded 35-minute job timings',()=>{
 const candidate={html:canvasGame(),method:'llm_code',provider:'offline',model:'authored',generationStatus:'succeeded',validationStatus:'passed',generation:{attempts:[{route:'primary',provider:'offline',requestedModel:'authored',model:'authored',outcome:'accepted',errorCode:null,elapsedMs:30*60000,requestMs:29*60000,validationMs:60000}],fallback:false,elapsedMs:30*60000,browser:{scope:'full-html',profiles:[320,390,844],offline:true,errors:0,rendering:{contract:'canvas-webgl-strict-v2',contexts:['2d'],profiles:[320,390,844]},elapsedMs:60000}}};
 assert.equal(parseArtifact(candidate).generation?.attempts[0].requestMs,29*60000);
 assert.equal(parseArtifact({...candidate,generation:{...candidate.generation,elapsedMs:35*60000}}).generation?.elapsedMs,35*60000);
 for(const elapsedMs of [-1,35*60000+1,Infinity,NaN,1.5])assert.throws(()=>parseArtifact({...candidate,generation:{...candidate.generation,elapsedMs}}),/INVALID_GENERATION_METADATA/);
});

for(const code of ['BROWSER_CANVAS_RENDER_UNVERIFIED','BROWSER_CANVAS_ACTIVITY_UNVERIFIED','BROWSER_CANVAS_REQUIRED','BROWSER_DOM_GAME_WORLD','BROWSER_DOM_GAME_UI','BROWSER_CANVAS_DOM_UNVERIFIED'])test('render refusal preserves its evidence level and cannot repair or fall back: '+code,async()=>{
 let calls=0,level='';
 const route={route:'primary' as const,provider:'offline',model:'authored',readiness:async()=>'ready' as const,complete:async()=>{calls++;return{code:canvasGame(),model:'authored'};}};
 const engine=new GenerationEngine([route,{...route,route:'secondary'}],{allowLlmRepair:true,repairs:1,check:async()=>{throw new Fault(code,502);}});
 try{
  await assert.rejects(engine.generate(spec,undefined,'llm_code',undefined,{dispatch:()=>{},stage:()=>{},partial:()=>{},attempt:()=>{},validation:d=>{level=d.level;}}),new RegExp(code));
  assert.equal(calls,1);assert.equal(level,code.endsWith('_UNVERIFIED')?'NOT_VERIFIED':'FAILED');
 }finally{engine.close();}
});
