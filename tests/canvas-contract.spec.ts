import {strictCanvas,strictAnimated} from './strict-canvas-fixtures.ts';
import {test,expect} from '@playwright/test';
import {checkFullHtml} from '../src/full-html-check.ts';
import {browserCheck} from '../src/browser-check.ts';
import {canvasGame,domGame,terminalCanvas,animatedWebgl} from './canvas-fixtures.ts';
import {GenerationEngine} from '../src/live.ts';
import {GenerationJobs} from '../src/jobs.ts';
import {Store} from '../src/store.ts';
import {createApp} from '../src/api.ts';
import {spec,html} from './helpers.ts';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {canvasSnapshot,observeCanvas} from '../src/canvas-check.ts';

test.beforeEach(({},info)=>test.skip(info.project.name!=='chromium-desktop','Production validator uses Chromium.'));

test('sampled Canvas rendering preserves a fine grid and small game pieces on square boards',async({browser})=>{
 const context=await browser.newContext({viewport:{width:320,height:700},deviceScaleFactor:2});
 const key='__fine_grid_canvas_test';
 const source='<!doctype html><html><body style="margin:0;background:#222"><canvas width="320" height="320" style="width:320px;height:320px"></canvas><script>const c=document.querySelector("canvas"),x=c.getContext("2d");x.fillStyle="#1a472a";x.fillRect(0,0,320,320);x.strokeStyle="#224f34";x.lineWidth=1;for(let n=0;n<=320;n+=20){x.beginPath();x.moveTo(n,0);x.lineTo(n,320);x.stroke();x.beginPath();x.moveTo(0,n);x.lineTo(320,n);x.stroke()}x.fillStyle="#4caf50";x.fillRect(160,160,20,20);x.fillStyle="#ff5252";x.beginPath();x.arc(60,160,8,0,Math.PI*2);x.fill();x.fillStyle="#fff";x.font="16px sans-serif";x.fillText("Score: 0",16,24);</script></body></html>';
 try{
  await context.addInitScript(observeCanvas,{key,html:source});const page=await context.newPage();await page.setContent('<iframe sandbox="allow-scripts"></iframe>');await page.locator('iframe').evaluate((frame,markup)=>{if(!(frame instanceof HTMLIFrameElement))throw Error('IFRAME_REQUIRED');frame.srcdoc=markup},source);const frame=await(await page.locator('iframe').elementHandle())!.contentFrame();expect(frame).toBeTruthy();await frame!.waitForLoadState('load');await page.waitForTimeout(100);
  const sample=await canvasSnapshot(frame!,key);expect(sample.canvases).toHaveLength(1);expect(sample.canvases[0].meaningful).toBe(true);
 }finally{await context.close();}
});

test('sampled Canvas rendering preserves small gameplay pieces on a wide landscape surface',async({browser})=>{
 const context=await browser.newContext({viewport:{width:844,height:390},deviceScaleFactor:2});
 const key='__landscape_fine_canvas_test';
 const source='<!doctype html><html><body style="margin:0;background:#222"><canvas width="600" height="380" style="width:600px;height:380px"></canvas><script>const c=document.querySelector("canvas"),x=c.getContext("2d");x.fillStyle="#4caf50";x.fillRect(292,182,16,16);x.fillStyle="#ff5252";x.fillRect(100,100,10,10);</script></body></html>';
 try{
  await context.addInitScript(observeCanvas,{key,html:source});const page=await context.newPage();await page.setContent('<iframe sandbox="allow-scripts"></iframe>');await page.locator('iframe').evaluate((frame,markup)=>{if(!(frame instanceof HTMLIFrameElement))throw Error('IFRAME_REQUIRED');frame.srcdoc=markup},source);const frame=await(await page.locator('iframe').elementHandle())!.contentFrame();expect(frame).toBeTruthy();await frame!.waitForLoadState('load');
  const sample=await canvasSnapshot(frame!,key);expect(sample.canvases).toHaveLength(1);expect(sample.canvases[0].meaningful).toBe(true);
 }finally{await context.close();}
});

test('full HTML reaches a Start control near the bottom of a Canvas',async({browser})=>{
 const source='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block;width:100vw;height:100vh;touch-action:none}</style></head><body><canvas width="320" height="700"></canvas><script>const c=document.querySelector("canvas"),x=c.getContext("2d");let active=false,n=0;function draw(){x.fillStyle="#15253a";x.fillRect(0,0,c.width,c.height);if(!active){x.fillStyle="#4caf50";x.fillRect(c.width*.2,c.height*.82,c.width*.6,c.height*.12)}else{x.fillStyle="#ff5252";x.fillRect(40+n*17,120,24,24);x.fillStyle="#4caf50";x.fillRect(100,220,32,32)}}c.addEventListener("pointerdown",e=>{if(!active&&e.clientY/innerHeight>.8)active=true;else if(active)n++;draw()});draw();</script></body></html>';
 const viewports:string[]=[];const result=await checkFullHtml(browser,source,AbortSignal.timeout(18000),((event:string,data:any)=>{if(event==='browser.viewport.completed'&&data?.status==='PASS')viewports.push(String(data.details?.viewport));}) as any);
 expect(result.rendering?.profiles).toEqual([320,390,844]);expect(viewports).toEqual(['320x700','390x700','844x390']);
});

test('full HTML exercises keyboard gameplay inside the opaque iframe after Canvas Start',async()=>{
 const source='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0}canvas{display:block;width:100vw;height:100vh;touch-action:none}</style></head><body><canvas width="320" height="700"></canvas><script>const c=document.querySelector("canvas"),x=c.getContext("2d");let active=false,position=0;function draw(){x.fillStyle="#15253a";x.fillRect(0,0,320,700);x.fillStyle="#4caf50";x.fillRect(40,200,100,80);x.fillStyle="#ff5252";x.fillRect(active?80+position:200,active?400:300,50,50);x.fillStyle="white";x.font="20px sans-serif";x.fillText(active?"Score "+position:"START",130,350)}c.addEventListener("pointerdown",()=>{if(!active){active=true;draw()}});addEventListener("keydown",e=>{if(active&&e.key==="ArrowRight"){position+=20;draw()}});draw();</script></body></html>';
 const evidence=await browserCheck(source,AbortSignal.timeout(18000));
 expect(evidence.checks).toContainEqual({aspect:'html-runs',level:'VERIFIED'});
 expect(evidence.checks).toContainEqual({aspect:'gameplay-observed',level:'NOT_VERIFIED'});
 // A Start-only visual change must still fail when gameplay ignores controls.
 await expect(browserCheck(source.replace('if(active&&e.key===','if(false&&e.key==='),AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_CANVAS_ACTIVITY_UNVERIFIED'});
});

test('full HTML reaches a centered Canvas Start control around y=0.58',async({browser})=>{
 const source='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block;width:100vw;height:100vh;touch-action:none}</style></head><body><canvas width="320" height="700"></canvas><script>const c=document.querySelector("canvas"),x=c.getContext("2d");let active=false,n=0;function draw(){x.fillStyle="#15253a";x.fillRect(0,0,c.width,c.height);if(!active){x.fillStyle="#4caf50";x.fillRect(c.width*.2,c.height*.55,c.width*.6,c.height*.08)}else{x.fillStyle="#ff5252";x.fillRect(40+n*17,120,24,24);x.fillStyle="#4caf50";x.fillRect(100,220,32,32)}}c.addEventListener("pointerdown",e=>{if(!active&&e.clientY/innerHeight>.55&&e.clientY/innerHeight<.63)active=true;else if(active)n++;draw()});draw();</script></body></html>';
 const result=await checkFullHtml(browser,source,AbortSignal.timeout(18000));
 expect(result.scope).toBe('full-html');expect(result.checks).toContainEqual({aspect:'gameplay-observed',level:'NOT_VERIFIED'});
});

test('Canvas markers without YAPLIX event bridge use the generic full HTML validator',async()=>{
 const source='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block;width:100vw;height:100vh;touch-action:none}</style></head><body><canvas data-yaplix-start data-yaplix-input width="320" height="700"></canvas><script>const c=document.querySelector("canvas"),x=c.getContext("2d");let active=false,n=0;function draw(){x.fillStyle="#15253a";x.fillRect(0,0,c.width,c.height);if(!active){x.fillStyle="#4caf50";x.fillRect(c.width*.2,c.height*.82,c.width*.6,c.height*.12)}else{x.fillStyle="#ff5252";x.fillRect(40+n*17,120,24,24);x.fillStyle="#4caf50";x.fillRect(100,220,32,32)}}c.addEventListener("pointerdown",e=>{if(!active&&e.clientY/innerHeight>.8)active=true;else if(active)n++;draw()});draw();</script></body></html>';
 const result=await browserCheck(source,AbortSignal.timeout(18000));
 expect(result.scope).toBe('full-html');expect(result.checks).toContainEqual({aspect:'gameplay-observed',level:'NOT_VERIFIED'});
});

test('A1.8.9 reports only repeated, provable Canvas text bounds outside its backing bitmap',async({browser})=>{
 const source='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block;width:100vw;height:100vh;touch-action:none}</style></head><body><canvas width="320" height="700"></canvas><script>const c=document.querySelector("canvas"),x=c.getContext("2d");let n=0;function draw(){x.setTransform(c.width/innerWidth,0,0,c.height/innerHeight,0,0);x.fillStyle="#15253a";x.fillRect(0,0,innerWidth,innerHeight);x.fillStyle="#f3c84b";x.fillRect(100+n%20,180,60,60);x.fillStyle="#fff";x.font="20px sans-serif";x.textAlign="left";x.textBaseline="alphabetic";x.fillText("Clipped instruction",-18,70)}c.addEventListener("pointerdown",()=>{n++;draw()});draw();</script></body></html>';
 let capture:{viewport:string;image:Uint8Array}|undefined;const events:any[]=[];
 await expect(checkFullHtml(browser,source,AbortSignal.timeout(18000),((event:string,data:any)=>events.push({event,data})) as any,(viewport,image)=>{capture={viewport,image};return{captureId:'canvas-layout-test',sha256:'0'.repeat(64)};})).rejects.toMatchObject({code:'BROWSER_CANVAS_TEXT_CLIPPED',feedback:expect.stringMatching(/"confirmed":true.*"edges":\["left"\]/)});
 expect(capture?.viewport).toBe('320x700');expect(capture?.image.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
 const rejection=events.find(value=>value.event==='browser.viewport.completed'&&value.data?.errorCode==='BROWSER_CANVAS_TEXT_CLIPPED');expect(rejection?.data.details.canvasTextLayout.confirmed).toBe(true);expect(rejection?.data.details.canvasTextLayout.texts[0].clippedCss.left).toBeGreaterThan(1);
});

test('A1.8.9 keeps Canvas clip uncertainty after an unmatched restore',async({browser})=>{
 const source='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><canvas width="320" height="700" style="width:320px;height:700px"></canvas><script>const c=document.querySelector("canvas"),x=c.getContext("2d");x.fillStyle="#123456";x.fillRect(0,0,320,700);x.beginPath();x.rect(0,0,320,700);x.clip();x.restore();x.fillStyle="#fff";x.font="20px sans-serif";x.fillText("clipped",-18,70);</script></body></html>';
 const context=await browser.newContext({viewport:{width:320,height:700},offline:true});
 try{const key='canvasClipProbe';await context.addInitScript(observeCanvas,{key,html:source});await context.route('**/*',route=>route.request().url()==='https://canvas-clip.invalid/'?route.fulfill({contentType:'text/html',body:source}):route.abort());const page=await context.newPage();await page.goto('https://canvas-clip.invalid/');const text=(await canvasSnapshot(page.mainFrame(),key)).canvases[0].texts?.[0];expect(text?.status).toBe('NOT_VERIFIED');expect(text?.reason).toBe('active-clip');}finally{await context.close();}
});

test('A1.8.9 leaves unknown Canvas hitboxes unverified and completes offline layout probes at all three viewports',async({browser})=>{
 const source='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block;width:100vw;height:100vh;touch-action:none}</style></head><body><canvas width="320" height="700"></canvas><script>const c=document.querySelector("canvas"),x=c.getContext("2d");let n=0;function draw(){x.setTransform(c.width/innerWidth,0,0,c.height/innerHeight,0,0);x.fillStyle="#15253a";x.fillRect(0,0,innerWidth,innerHeight);x.fillStyle="#f3c84b";x.fillRect(n%2?210:10,180,60,60);x.fillStyle="#fff";x.font="20px sans-serif";x.textAlign="left";x.textBaseline="alphabetic";x.fillText("Readable instruction",18,70)}c.addEventListener("pointerdown",()=>{n++;draw()});draw();</script></body></html>';
 const viewports:string[]=[];const result=await checkFullHtml(browser,source,AbortSignal.timeout(18000),((event:string,data:any)=>{if(event==='browser.viewport.completed'&&data?.status==='PASS')viewports.push(String(data.details?.viewport));}) as any);
 expect(result.rendering?.profiles).toEqual([320,390,844]);expect(viewports).toEqual(['320x700','390x700','844x390']);
});

test('A1.8 rejects DOM-only games through the production HTML checker',async({browser})=>{
 await expect(checkFullHtml(browser,domGame,AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_DOM_GAME_UI'});
});

test('A1.8 lifecycle markers cannot bypass the rendering gate',async()=>{
 const source=html.replace('<main>','<main><div style="position:absolute;top:0;left:0;width:30px;height:30px;background:red">Sprite</div>');
 await expect(browserCheck(source,AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_DOM_GAME_UI'});
});

for(const kind of ['arcade','puzzle','webgl'])test('A1.8.6 rejects formerly accepted '+kind+' with DOM controls',async({browser})=>{
 await expect(checkFullHtml(browser,canvasGame(kind),AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_DOM_GAME_UI'});
});

test('A1.8 production job edit, SQLite restart, historical export and offline reopen',async({browser})=>{
 test.setTimeout(60000);
 const directory=mkdtempSync('.local/canvas-chain-'),path=directory+'/test.sqlite';
 let source=strictCanvas(),calls=0;
 const engine=new GenerationEngine([{route:'primary',provider:'offline-fixture',model:'authored',readiness:async()=>'ready',complete:async(messages)=>{
  calls++;if(calls===1)expect(messages[1].content).toContain(domGame);
  return{code:source,model:'authored'};
 }}],{allowLlmRepair:true,repairs:1});
 let store=new Store(path),jobs=new GenerationJobs(store,engine);
 const settled=async(id:string)=>{await expect.poll(()=>jobs.get('owner',id).stage,{timeout:25000}).toMatch(/^(completed|needs_attention|failed)$/);return jobs.get('owner',id);};
 try{
  const historical=store.save(spec,{html:domGame,method:'mock',provider:'authored',model:null,generationStatus:'succeeded',validationStatus:'unverified'});
  const done=await settled(jobs.create('owner','canvas-edit',{spec,mode:'live',previousVersionId:historical.versionId,telegramConsent:false}).jobId);
  expect(done.stage).toBe('completed');expect(calls).toBe(1);
  const version=store.getVersion(done.versionId!);
  expect(version.previousVersionId).toBe(historical.versionId);expect(store.history(historical.gameId)).toHaveLength(2);
  expect(version.generation?.browser.rendering?.contexts).toEqual(['2d']);
  await jobs.close();store.close();store=new Store(path);jobs=new GenerationJobs(store,engine);
  // Reuse the restarted worker coordinator. A second implicit coordinator
  // cannot claim the SQLite worker lease and would make export diagnostics
  // fail with JOB_WORKER_BUSY before the export request is reached.
  const app=createApp(store,undefined,undefined,undefined,undefined,undefined,jobs);
  expect(store.getVersion(version.versionId)).toEqual(version);expect(store.getVersion(historical.versionId)).toEqual(historical);
  expect(await(await app.request('/api/versions/'+historical.versionId+'/export')).text()).toBe(domGame);
  const exported=await(await app.request('/api/versions/'+version.versionId+'/export')).text();expect(exported).toBe(source);
  const offline=resolve(directory,'export.html');writeFileSync(offline,exported);
  const context=await browser.newContext({offline:true,hasTouch:true,viewport:{width:390,height:700}});
  try{
   const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(pathToFileURL(offline).href);const canvas=page.locator('canvas');await canvas.tap();const before=await canvas.evaluate(c=>(c as HTMLCanvasElement).toDataURL());
   await canvas.tap();expect(await canvas.evaluate(c=>(c as HTMLCanvasElement).toDataURL())).not.toBe(before);
   expect(errors).toEqual([]);
  }finally{await context.close();}
  // A real failed browser gate is retained in durable history, with no new
  // version, repair or second dispatch even when repair was enabled.
  source=domGame;
  const failed=await settled(jobs.create('owner','canvas-refusal',{spec,mode:'live',previousVersionId:version.versionId,telegramConsent:false}).jobId);
  expect(failed.stage).toBe('needs_attention');expect(failed.errorCode).toBe('BROWSER_DOM_GAME_UI');
  expect(failed.originalCheckpoint).toBe(domGame);expect(failed.validation?.level).toBe('FAILED');expect(calls).toBe(2);
  expect(store.history(historical.gameId)).toHaveLength(2);expect(failed.versionId).toBeNull();
  const refusedId=failed.jobId;
  await jobs.close();store.close();store=new Store(path);jobs=new GenerationJobs(store,engine);
  expect(jobs.get('owner',refusedId).errorCode).toBe('BROWSER_DOM_GAME_UI');
  jobs.continue('owner',refusedId);expect((await settled(refusedId)).stage).toBe('needs_attention');
  expect(calls).toBe(2);expect(store.history(historical.gameId)).toHaveLength(2);
 }finally{await jobs.close();engine.close();store.close();}
});

for(const [name,markup] of [
 ['marker',`<li style="position:fixed;left:160px;top:5px;width:1px;height:25px;list-style-type:'Score 100';color:white;font-size:20px"></li>`],
 ['zero pseudo','<style>#probe::before{content:"Pause";position:fixed;left:0;top:0;width:0;height:0;overflow:visible;color:white;font-size:20px}</style><div id="probe"></div>'],
] as const)test('A1.8.8 production CSS refusal preserves draft/version/Continue: '+name,async()=>{
 test.setTimeout(45000);
 const path=mkdtempSync('.local/css-refusal-')+'/test.sqlite';
 const source=strictCanvas().replace('<body>','<body>'+markup);let calls=0,fallbacks=0;
 const route={route:'primary' as const,provider:'offline-fixture',model:'authored',readiness:async()=>'ready' as const,complete:async()=>{calls++;return{code:source,model:'authored'};}};
 const engine=new GenerationEngine([route,{...route,route:'secondary',complete:async()=>{fallbacks++;throw Error('UNEXPECTED_FALLBACK');}}],{allowLlmRepair:true,repairs:1});
 let store=new Store(path),jobs=new GenerationJobs(store,engine);
 const settled=async(id:string)=>{await expect.poll(()=>jobs.get('owner',id).stage,{timeout:25000}).toBe('needs_attention');return jobs.get('owner',id);};
 try{
  const old=store.save(spec,{html:strictCanvas(),method:'mock',provider:'authored',model:null,generationStatus:'succeeded',validationStatus:'unverified'});
  const refused=await settled(jobs.create('owner','css-'+name.replaceAll(' ','-'),{spec,mode:'live',previousVersionId:old.versionId,telegramConsent:false}).jobId);
  expect(refused).toMatchObject({versionId:null,errorCode:'BROWSER_CANVAS_DOM_UNVERIFIED',checkpoint:source,originalCheckpoint:source,attempts:1,validation:{level:'NOT_VERIFIED'}});
  expect(store.history(old.gameId)).toHaveLength(1);expect(store.getVersion(old.versionId)).toEqual(old);expect(calls).toBe(1);expect(fallbacks).toBe(0);
  await jobs.close();store.close();store=new Store(path);jobs=new GenerationJobs(store,engine);
  expect(jobs.get('owner',refused.jobId).originalCheckpoint).toBe(source);
  jobs.continue('owner',refused.jobId);
  expect(await settled(refused.jobId)).toMatchObject({versionId:null,errorCode:'BROWSER_CANVAS_DOM_UNVERIFIED',validation:{level:'NOT_VERIFIED'}});
  expect(calls).toBe(1);expect(fallbacks).toBe(0);expect(store.history(old.gameId)).toHaveLength(1);
  expect(await(await createApp(store,undefined,undefined,undefined,undefined,undefined,jobs).request('/api/versions/'+old.versionId+'/export')).text()).toBe(old.html);
 }finally{await jobs.close();engine.close();store.close();}
});
for(const [name,source] of [
 ['SVG only',domGame.replace('<button','<svg width="300" height="180"><rect width="100" height="100"/></svg><button'),'BROWSER_DOM_GAME_WORLD'],
 ['empty',domGame.replace('<button','<canvas></canvas><button'),'BROWSER_CANVAS_RENDER_UNVERIFIED'],
 ['hidden',canvasGame().replace('<canvas ','<canvas style="display:none" '),'BROWSER_CANVAS_REQUIRED'],
 ['zero',canvasGame().replace('height:180px;','height:0px;'),'BROWSER_CANVAS_REQUIRED'],
 ['no draw calls',canvasGame().replaceAll('draw();',''),'BROWSER_CANVAS_RENDER_UNVERIFIED'],
 ['inert logic',canvasGame('inert'),'BROWSER_CANVAS_ACTIVITY_UNVERIFIED'],
 ['decorative canvas',canvasGame().replace('<output>','<div style="position:absolute;left:100px;top:100px;width:30px;height:30px;background:red"></div><output>'),'BROWSER_DOM_GAME_WORLD'],
 ['DOM grid world',canvasGame().replace('<output>','<div style="display:grid;grid-template-columns:repeat(4,30px)">'+Array.from({length:4},()=>'<div style="width:30px;height:30px;background:red">Tile</div>').join('')+'</div><output>'),'BROWSER_DOM_GAME_WORLD'],
 ['after Start error',canvasGame().replace('active=true;','throw Error("after Start");active=true;'),'JAVASCRIPT_EXCEPTION'],
 ['landscape canvas',canvasGame().replace('</style>','@media(orientation:landscape){canvas{height:500px}}</style>'),'BROWSER_CANVAS_LAYOUT'],
] as const)test('strict contract rejects historical DOM fixture: '+name,async({browser})=>{
 await expect(checkFullHtml(browser,source,AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_DOM_GAME_UI'});
});
for(const [name,source,code] of [
 ['hidden Canvas',strictCanvas().replace('canvas{display:block','canvas{display:none'),'BROWSER_CANVAS_REQUIRED'],
 ['zero-height Canvas',strictCanvas().replace('height:100%;touch-action','height:0;touch-action'),'BROWSER_CANVAS_REQUIRED'],
 ['no draw',strictCanvas().replace('function draw(){','function draw(){return;'),'BROWSER_CANVAS_RENDER_UNVERIFIED'],
 ['inert logic',strictCanvas().replace('function act(){','function act(){return;'),'BROWSER_CANVAS_ACTIVITY_UNVERIFIED'],
 ['clipped landscape',strictCanvas().replace('</style>','@media(orientation:landscape){canvas{height:500px}}</style>'),'BROWSER_CANVAS_LAYOUT'],
] as const)test('strict rendering regression: '+name,async({browser})=>{
 await expect(checkFullHtml(browser,source,AbortSignal.timeout(18000))).rejects.toMatchObject({code});
});

test('A1.8 rejects WebGL frames explicitly cleared after drawing',async({browser})=>{
 const source=strictCanvas('webgl').replace('gl.drawArrays(gl.TRIANGLES,0,3);','gl.drawArrays(gl.TRIANGLES,0,3);gl.clear(gl.COLOR_BUFFER_BIT);');
 await expect(checkFullHtml(browser,source,AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_CANVAS_RENDER_UNVERIFIED'});
});

test('A1.8 rejects WebGL frames erased by a backing store reset',async({browser})=>{
 const source=strictCanvas('webgl').replace('gl.drawArrays(gl.TRIANGLES,0,3);','gl.drawArrays(gl.TRIANGLES,0,3);surface.width=surface.width;');
 await expect(checkFullHtml(browser,source,AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_CANVAS_RENDER_UNVERIFIED'});
});

for(const kind of ['2d','webgl','webgl2'])for(const reset of [false,true])test(`strict Canvas rejects late ${reset?'backing reset':'clear'} in ${kind}`,async()=>{
 const erase=reset?'surface.width=surface.width;':kind==='2d'?'ctx.clearRect(0,0,surface.width,surface.height);':'gl.clear(gl.COLOR_BUFFER_BIT);';
 const source=strictCanvas(kind).replace('step++;draw();','step++;draw();if(step>=2){'+erase+'}');
 await expect(browserCheck(source,AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_CANVAS_RENDER_UNVERIFIED'});
});
for(const kind of ['2d','webgl','webgl2'])test(`strict Canvas accepts ${kind} backing resize followed by redraw`,async()=>{
 const source=strictCanvas(kind).replace('step++;draw();','step++;surface.width=surface.width;draw();');
 expect((await browserCheck(source,AbortSignal.timeout(18000))).rendering?.contexts).toContain(kind);
});
test('strict Canvas checks keyboard errors and final image',async()=>{
 const source=strictCanvas().replace("if(e.key==='ArrowRight'||e.key===' ')act();","if(e.key==='ArrowRight'){act();ctx.clearRect(0,0,surface.width,surface.height);}");
 await expect(browserCheck(source,AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_CANVAS_RENDER_UNVERIFIED'});
});
for(const crash of [false,true])test('strict Canvas leaves unproven Restart behavior unverified, crash='+crash,async()=>{
 const source=strictCanvas().replace('step=0;paused=false;draw();',crash?'throw Error("restart failed");':'step=0;paused=false;ctx.clearRect(0,0,surface.width,surface.height);');
 const report=await browserCheck(source,AbortSignal.timeout(18000));
 expect(report.errors).toBe(0);
 expect(report.checks?.find(check=>check.aspect==='restart-works')?.level).toBe('NOT_VERIFIED');
});
test('strict Canvas allows bounded clear-to-redraw transition',async()=>{
 const source=strictCanvas().replace('step++;draw();','step++;ctx.clearRect(0,0,surface.width,surface.height);setTimeout(draw,75);');
 await expect(browserCheck(source,AbortSignal.timeout(18000))).resolves.toMatchObject({rendering:{contexts:['2d']}});
});
for(const restart of [false,true])test('strict Canvas rejects historical DOM terminal allowance, restart='+restart,async()=>{
 await expect(browserCheck(terminalCanvas({restart}),AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_DOM_GAME_UI'});
});
for(const kind of ['webgl','webgl2'])for(const ending of ['draw','redraw','stop','halt','clear','reset'])test(`strict animated ${kind} preserveDrawingBuffer=false ending=${ending}`,async()=>{
 const result=browserCheck(strictAnimated(kind,ending),AbortSignal.timeout(18000));
 if(ending==='draw'||ending==='redraw')expect((await result).rendering?.contexts).toContain(kind);
 else await expect(result).rejects.toMatchObject({code:'BROWSER_CANVAS_RENDER_UNVERIFIED'});
});
for(const kind of ['webgl','webgl2'])test(`A1.8.5 ${kind} fixture has native false buffer, running frames, score, win and Restart`,async({browser})=>{
 const context=await browser.newContext({offline:true,hasTouch:true,viewport:{width:390,height:700}});
 try{
  const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent(animatedWebgl(kind));
  expect(await page.locator('canvas').evaluate((c,kind)=>Boolean((c as HTMLCanvasElement).getContext(kind as 'webgl')),kind),'Chromium must create a real WebGL context for this positive fixture').toBe(true);
  expect(await page.locator('canvas').evaluate((c,kind)=>(c as HTMLCanvasElement).getContext(kind as 'webgl')!.getContextAttributes()!.preserveDrawingBuffer,kind)).toBe(false);
  await page.getByRole('button',{name:'Start',exact:true}).tap();
  const before=Number(await page.locator('canvas').getAttribute('data-frame'));
  await page.waitForTimeout(80);expect(Number(await page.locator('canvas').getAttribute('data-frame'))).toBeGreaterThan(before);
  for(let n=0;n<6;n++)await page.getByRole('button',{name:'Move',exact:true}).tap();
  await expect(page.locator('output')).toHaveText('Score 3');await expect(page.getByRole('heading',{name:'You won'})).toBeVisible();
  await page.getByRole('button',{name:'Restart',exact:true}).tap();
  await expect(page.getByRole('heading',{name:'You won'})).toBeHidden();await expect(page.locator('output')).toHaveText('Score 0');
  await page.locator('canvas').tap();await page.getByRole('button',{name:'Move',exact:true}).tap();await expect(page.locator('output')).toHaveText('Score 1');
  expect(errors).toEqual([]);
 }finally{await context.close();}
});
