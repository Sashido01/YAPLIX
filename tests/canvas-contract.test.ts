import test from 'node:test';
import assert from 'node:assert/strict';
import {generationMessages} from '../src/generation.ts';
import {Store} from '../src/store.ts';
import {parseArtifact,Fault} from '../src/contracts.ts';
import {GenerationEngine} from '../src/live.ts';
import {BrowserFailure} from '../src/browser-check.ts';
import {canvasDiagnosticFeedback} from '../src/canvas-check.ts';
import {webglContextFailure} from '../src/full-html-check.ts';
import {spec} from './helpers.ts';
import {canvasGame,domGame} from './canvas-fixtures.ts';

test('a real null WebGL context gets a precise fail-closed diagnostic',()=>{
 assert.deepEqual(webglContextFailure('webgl','Cannot read properties of null (reading createProgram)'),{code:'BROWSER_WEBGL_CONTEXT_UNAVAILABLE',feedback:'webgl context creation returned null in the protected browser; no software fallback was used.'});
 assert.deepEqual(webglContextFailure('webgl2','Cannot read properties of null (reading shaderSource)'),{code:'BROWSER_WEBGL_CONTEXT_UNAVAILABLE',feedback:'webgl2 context creation returned null in the protected browser; no software fallback was used.'});
 assert.equal(webglContextFailure('', 'Cannot read properties of null (reading createProgram)'),undefined);
 assert.equal(webglContextFailure('webgl','an unrelated game error'),undefined);
});

test('Canvas repair feedback retains a confirmed clipped label after a later clean frame',()=>{
 const clipped={textHash:'12345',length:8,edges:['left'],bounds:{left:-8,top:10,right:80,bottom:30},clippedCss:{left:8,top:0,right:0,bottom:0},textAlign:'left',textBaseline:'alphabetic',transform:[1,0,0,1,0,0],canvas:{width:320,height:700,cssWidth:320,cssHeight:700},stableSamples:2,status:'CLIPPED'};
 const clean={...clipped,edges:[],bounds:{left:8,top:10,right:80,bottom:30},clippedCss:{left:0,top:0,right:0,bottom:0},status:'VISIBLE'};
 const snapshot=(texts:any[])=>({dom:0,canvases:[{id:1,context:'2d',draws:3,image:'123',meaningful:true,sampling:{width:128,height:256,colorBuckets:12,significantColors:6,largestColorPixels:100},fits:true,exposed:true,layoutCoverage:'canvas2d-text-metrics',unverifiedText:0,textOverlapCoverage:'VERIFIED',texts,textOverlaps:[]} ]}) as any;
 const feedback=JSON.parse(canvasDiagnosticFeedback('BROWSER_CANVAS_TEXT_CLIPPED','layout',[snapshot([clipped]),snapshot([clean])],[],{width:320,height:700}));
 assert.equal(feedback.canvasTextLayout.confirmed,true);assert.equal(feedback.canvasTextLayout.texts[0].status,'CLIPPED');
});

test('all prompt styles require the strict Canvas-only contract for new games and DOM edits',()=>{
 const store=new Store(':memory:');
 try{
  const old=store.save(spec,{html:domGame,method:'mock',provider:null,model:null,generationStatus:'succeeded',validationStatus:'unverified'});
  for(const style of ['direct','spec','intent'] as const)for(const previous of [undefined,old]){
   const messages=generationMessages({...spec,prompt:'Create a puzzle'},previous,style);
   assert.match(messages[0].content,/CANVAS-ONLY: Canvas 2D or WebGL is the only visible game surface/);
   assert.match(messages[0].content,/Draw the world and all visible game UI, including instructions, controls, score and state screens, in Canvas/);
   assert.match(messages[0].content,/Start at a readable START screen.*do not autoplay/);
   assert.match(messages[0].content,/Use requestAnimationFrame with bounded delta time.*keep one loop/s);
   assert.match(messages[0].content,/avoid artificial motion/);
   assert.match(messages[0].content,/Keep controls reachable and all essential text inside Canvas/);
   assert.match(messages[0].content,/Avoid clipping and material text\/control overlap/);
   assert.match(messages[0].content,/Use Canvas hitboxes and real input handlers/);
   assert.match(messages[0].content,/YAPLIX\/Arena event-v1 postMessage protocol is allowed/);
   assert.doesNotMatch(messages[0].content,/Choose Canvas or DOM/);
   if(previous){if(style==='intent')assert.equal(JSON.parse(messages[1].content).currentCompleteHtml,previous.html);else assert.ok(messages[1].content.includes(previous.html));}
  }
 }finally{store.close();}
});

test('Ollama may repair confirmed DOM game UI once; Canvas uncertainty and other providers remain non-repairable',async()=>{
 let calls=0,checks=0;const prompts:Array<{role:string;content:string}[]> = [];
 const route={route:'primary' as const,provider:'ollama.com',model:'gemma4:31b',readiness:async()=>'ready' as const,complete:async(messages:any[])=>{prompts.push(structuredClone(messages));calls++;return{code:calls===1?domGame:canvasGame(),model:'gemma4:31b'};}};
 const engine=new GenerationEngine([route],{allowLlmRepair:true,repairs:2,check:async()=>{if(++checks===1)throw Object.assign(new Fault('BROWSER_DOM_GAME_UI',502),{feedback:'Visible HTML button and menu text were detected.'});return{rendering:{contract:'canvas-webgl-strict-v2' as const,contexts:['2d' as const],profiles:[320,390,844]},profiles:[320,390,844],offline:true as const,errors:0 as const,scope:'full-html' as const};}});
 try{
  const result=await engine.generate({...spec,prompt:'Змейка для бабушки'},undefined,'llm_code');
  assert.equal(result.validationStatus,'passed');assert.equal(calls,2);assert.equal(checks,2);assert.equal(engine.repairLimit,2);
  assert.equal(prompts[1].at(-2)?.content,domGame);assert.match(prompts[1].at(-1)?.content??'',/BROWSER_DOM_GAME_UI/);assert.match(prompts[1].at(-1)?.content??'',/Convert every visible instruction, control, menu, HUD, score and game-state screen into Canvas/);assert.match(prompts[1].at(-1)?.content??'',/Змейка для бабушки/);
 }finally{engine.close();}
});

test('Ollama game-loop repair requires explicit Start and stalled-loop evidence',async()=>{
 for(const confirmed of [false,true]){
  let calls=0,checks=0;const prompts:Array<any[]> = [];
  const route={route:'primary' as const,provider:'ollama.com',model:'gemma4:31b',readiness:async()=>'ready' as const,complete:async(messages:any[])=>{prompts.push(structuredClone(messages));calls++;return{code:canvasGame(),model:'gemma4:31b'};}};
  const engine=new GenerationEngine([route],{allowLlmRepair:true,repairs:2,check:async()=>{if(++checks===1)throw new BrowserFailure('BROWSER_GAME_LOOP_STALLED',JSON.stringify({confirmed,startAction:confirmed?'confirmed':'unverified',animationLoop:confirmed?'stalled':'unknown'}));return{rendering:{contract:'canvas-webgl-strict-v2' as const,contexts:['2d' as const],profiles:[320,390,844]},profiles:[320,390,844],offline:true as const,errors:0 as const,scope:'full-html' as const};}});
  try{
   if(confirmed){const result=await engine.generate({...spec,prompt:'Змейка для бабушки'},undefined,'llm_code');assert.equal(result.validationStatus,'passed');assert.equal(calls,2);assert.match(prompts[1].at(-1)?.content??'',/Start action entered the active state but the gameplay animation loop stalled/);}
   else{await assert.rejects(engine.generate(spec,undefined,'llm_code'),/BROWSER_GAME_LOOP_STALLED/);assert.equal(calls,1);}
  }finally{engine.close();}
 }
});

test('Ollama repairs only confirmed repeated Canvas text clipping and reruns the full checker',async()=>{
 const feedback=JSON.stringify({code:'BROWSER_CANVAS_TEXT_CLIPPED',canvasTextLayout:{status:'FAIL',confirmed:true,phase:'canvas-input',viewport:{width:320,height:700},dpr:2,texts:[{status:'CLIPPED',stableSamples:3,textHash:'12345',length:18,edges:['left'],bounds:{left:-12,top:20,right:140,bottom:44},clippedCss:{left:12,top:0,right:0,bottom:0},textAlign:'left',textBaseline:'alphabetic',transform:[1,0,0,1,0,0],canvas:{width:320,height:700,cssWidth:320,cssHeight:700}}]}});
 let calls=0,checks=0;const prompts:any[][]=[];
 const route={route:'primary' as const,provider:'ollama.com',model:'gemma4:31b',readiness:async()=>'ready' as const,complete:async(messages:any[])=>{prompts.push(structuredClone(messages));calls++;return{code:canvasGame(),model:'gemma4:31b'};}};
 const engine=new GenerationEngine([route],{allowLlmRepair:true,repairs:1,check:async()=>{if(++checks===1)throw Object.assign(new Fault('BROWSER_CANVAS_TEXT_CLIPPED',502),{feedback});return{rendering:{contract:'canvas-webgl-strict-v2' as const,contexts:['2d' as const],profiles:[320,390,844]},profiles:[320,390,844],offline:true as const,errors:0 as const,scope:'full-html' as const};}});
 try{const result=await engine.generate({...spec,prompt:'Новая игра с читаемыми подписями'},undefined,'llm_code');assert.equal(result.validationStatus,'passed');assert.equal(calls,2);assert.equal(checks,2);assert.equal(prompts[1].at(-2)?.content,canvasGame());assert.match(prompts[1].at(-1)?.content??'',/CANVAS_LAYOUT/);assert.match(prompts[1].at(-1)?.content??'',/glyph bounds outside the backing bitmap/);assert.match(prompts[1].at(-1)?.content??'',/viewport.*320x700/);}finally{engine.close();}
});

test('unconfirmed Canvas clipping and non-Ollama providers do not trigger repair',async()=>{
 for(const confirmed of [false,true]){
  let calls=0;const feedback=JSON.stringify({code:'BROWSER_CANVAS_TEXT_CLIPPED',canvasTextLayout:{status:confirmed?'FAIL':'NOT_VERIFIED',confirmed,phase:'canvas-input',viewport:{width:320,height:700},texts:[{status:confirmed?'CLIPPED':'NOT_VERIFIED',stableSamples:confirmed?2:1}]}});
  const provider=confirmed?'openrouter':'ollama.com';const route={route:'primary' as const,provider,model:confirmed?'openrouter/free':'gemma4:31b',readiness:async()=>'ready' as const,complete:async()=>{calls++;return{code:canvasGame(),model:provider};}};
  const engine=new GenerationEngine([route],{allowLlmRepair:true,defaultMode:confirmed?'openrouter':'auto',repairs:1,check:async()=>{throw Object.assign(new Fault('BROWSER_CANVAS_TEXT_CLIPPED',502),{feedback});}});
  try{await assert.rejects(engine.generate(spec,undefined,'llm_code'),/BROWSER_CANVAS_TEXT_CLIPPED/);assert.equal(calls,1);}finally{engine.close();}
 }
});

test('Ollama does not repair a Canvas-input timeout when the tap target is unverified',async()=>{
 const feedback=JSON.stringify({code:'BROWSER_TIMEOUT',phase:'canvas-input',viewport:{width:320,height:700},probes:[{point:[.5,.5],cssPoint:[160,280],tapAttempted:true,tapCompleted:true,before:{draws:342,image:'same'},after:{draws:342,image:'same'}}],jsErrors:[]});
 let calls=0,checks=0;const decisions:string[]=[];
 const route={route:'primary' as const,provider:'ollama.com',model:'gemma4:31b',readiness:async()=>'ready' as const,complete:async()=>{calls++;return{code:canvasGame(),model:'gemma4:31b'};}};
 const engine=new GenerationEngine([route],{allowLlmRepair:true,repairs:1,check:async()=>{checks++;throw Object.assign(new Fault('BROWSER_TIMEOUT_FULL_HTML',504),{feedback});}});
 try{
  await assert.rejects(engine.generate({...spec,prompt:'Тетрис с красивыми эффектами'},undefined,'llm_code',undefined,{dispatch(){},stage(){},partial(){},attempt(){},validation(){},trace:(event:string,data:any)=>{if(event==='repair.eligibility')decisions.push(data.status==='SKIPPED'?data.details.blockers[0]:data.status);}} as any),/BROWSER_TIMEOUT_FULL_HTML/);
  assert.equal(calls,1);assert.equal(checks,1);assert.deepEqual(decisions,['AMBIGUOUS_BROWSER_EVIDENCE']);
 }finally{engine.close();}
});

test('Canvas-input timeout without completed tap evidence remains non-repairable',async()=>{
 let calls=0;const route={route:'primary' as const,provider:'ollama.com',model:'gemma4:31b',readiness:async()=>'ready' as const,complete:async()=>{calls++;return{code:canvasGame(),model:'gemma4:31b'};}};
 const engine=new GenerationEngine([route],{allowLlmRepair:true,repairs:1,check:async()=>{throw Object.assign(new Fault('BROWSER_TIMEOUT_FULL_HTML',504),{feedback:JSON.stringify({phase:'canvas-input',probes:[{tapAttempted:true,tapCompleted:false}],jsErrors:[]})});}});
 try{await assert.rejects(engine.generate(spec,undefined,'llm_code'),/BROWSER_TIMEOUT_FULL_HTML/);assert.equal(calls,1);}finally{engine.close();}
});

test('Canvas failure diagnostics preserve viewport, actual tap coordinates, before/after evidence and unverified Start semantics',()=>{
 const before={id:1,context:'2d',draws:10,image:'a',meaningful:true,fits:true,exposed:true};
 const after={...before,draws:11,image:'b'};
 const feedback=JSON.parse(canvasDiagnosticFeedback('BROWSER_CANVAS_ACTIVITY_UNVERIFIED','canvas-input',[{canvases:[before],dom:0},{canvases:[after],dom:0}],[{point:[.5,.25],cssPoint:[160,175],canvasId:1,hashChanged:true,drawDelta:1,before,after,startActionEvidence:'unverified'}],{width:320,height:700},[]));
 assert.equal(feedback.viewport.width,320);assert.equal(feedback.viewport.height,700);assert.equal(feedback.viewport.dpr,2);assert.equal(feedback.probes[0].cssPoint[1],175);assert.equal(feedback.probes[0].before.image,'a');assert.equal(feedback.probes[0].after.image,'b');assert.match(feedback.startActionEvidence,/unverified/);assert.deepEqual(feedback.jsErrors,[]);
 const timeout=JSON.parse(canvasDiagnosticFeedback('BROWSER_TIMEOUT','canvas-input',[{canvases:[before],dom:0}],[{point:[.5,.5],canvasId:1,hashChanged:false,drawDelta:0,startActionEvidence:'unverified'}],{width:320,height:700},[]));assert.match(timeout.diagnosis,/does not prove which game action/);assert.equal(timeout.viewport.height,700);
});

test('render evidence survives metadata parsing; invalid evidence fails closed',()=>{
 const rendering={contract:'canvas-webgl-strict-v2',contexts:['2d'],profiles:[320,390,844]};
 const candidate={html:canvasGame(),method:'llm_code',provider:'offline',model:'authored',generationStatus:'succeeded',validationStatus:'passed',generation:{attempts:[{route:'primary',provider:'offline',requestedModel:'authored',model:'authored',outcome:'accepted',errorCode:null,elapsedMs:0}],fallback:false,elapsedMs:0,browser:{scope:'full-html',profiles:[320,390,844],offline:true,errors:0,rendering}}};
 assert.deepEqual(parseArtifact(candidate).generation?.browser.rendering,rendering);
 for(const invalid of [{...rendering,contexts:[]},{...rendering,contexts:['svg']},{...rendering,contexts:['2d','2d']},{...rendering,profiles:[320,390]},{...rendering,contract:'invented'}]){
  assert.throws(()=>parseArtifact({...candidate,generation:{...candidate.generation,browser:{...candidate.generation.browser,rendering:invalid}}}),/INVALID_GENERATION_METADATA/);
 }
});

test('generation metadata preserves generation timing through the 130-minute repair window',()=>{
 const candidate={html:canvasGame(),method:'llm_code',provider:'offline',model:'authored',generationStatus:'succeeded',validationStatus:'passed',generation:{attempts:[{route:'primary',provider:'offline',requestedModel:'authored',model:'authored',outcome:'accepted',errorCode:null,elapsedMs:30*60000,requestMs:29*60000,validationMs:60000}],fallback:false,elapsedMs:30*60000,browser:{scope:'full-html',profiles:[320,390,844],offline:true,errors:0,rendering:{contract:'canvas-webgl-strict-v2',contexts:['2d'],profiles:[320,390,844]},elapsedMs:60000}}};
 assert.equal(parseArtifact(candidate).generation?.attempts[0].requestMs,29*60000);
 assert.equal(parseArtifact({...candidate,generation:{...candidate.generation,elapsedMs:35*60000}}).generation?.elapsedMs,35*60000);
 for(const elapsedMs of [-1,130*60000+1,Infinity,NaN,1.5])assert.throws(()=>parseArtifact({...candidate,generation:{...candidate.generation,elapsedMs}}),/INVALID_GENERATION_METADATA/);
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
