import test from 'node:test';
import assert from 'node:assert/strict';
import {generationMessages} from '../src/generation.ts';
import {Store} from '../src/store.ts';
import {parseArtifact} from '../src/contracts.ts';
import {spec} from './helpers.ts';
import {canvasGame,domGame} from './canvas-fixtures.ts';

test('all prompt styles require Canvas/WebGL for new games and conversion of DOM edits',()=>{
 const store=new Store(':memory:');
 try{
  const old=store.save(spec,{html:domGame,method:'mock',provider:null,model:null,generationStatus:'succeeded',validationStatus:'unverified'});
  for(const style of ['direct','spec','intent'] as const)for(const previous of [undefined,old]){
   const messages=generationMessages({...spec,prompt:'Create a puzzle'},previous,style);
   assert.match(messages[0].content,/Render the game world and all gameplay objects/);
   assert.match(messages[0].content,/DOM is only for menus, HUD, controls/);
   assert.match(messages[0].content,/Convert any existing DOM gameplay rendering/);
   assert.doesNotMatch(messages[0].content,/Choose Canvas or DOM/);
   if(previous){if(style==='intent')assert.equal(JSON.parse(messages[1].content).currentCompleteHtml,previous.html);else assert.ok(messages[1].content.includes(previous.html));}
  }
 }finally{store.close();}
});

test('render evidence survives metadata parsing; invalid evidence fails closed',()=>{
 const rendering={contract:'canvas-webgl-v1',contexts:['2d'],profiles:[320,390,844]};
 const candidate={html:canvasGame(),method:'llm_code',provider:'offline',model:'authored',generationStatus:'succeeded',validationStatus:'passed',generation:{attempts:[{route:'primary',provider:'offline',requestedModel:'authored',model:'authored',outcome:'accepted',errorCode:null,elapsedMs:0}],fallback:false,elapsedMs:0,browser:{scope:'full-html',profiles:[320,390,844],offline:true,errors:0,rendering}}};
 assert.deepEqual(parseArtifact(candidate).generation?.browser.rendering,rendering);
 for(const invalid of [{...rendering,contexts:[]},{...rendering,contexts:['svg']},{...rendering,contexts:['2d','2d']},{...rendering,profiles:[320,390]},{...rendering,contract:'invented'}]){
  assert.throws(()=>parseArtifact({...candidate,generation:{...candidate.generation,browser:{...candidate.generation.browser,rendering:invalid}}}),/INVALID_GENERATION_METADATA/);
 }
});
