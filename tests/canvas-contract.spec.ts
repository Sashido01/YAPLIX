import {test,expect} from '@playwright/test';
import {checkFullHtml} from '../src/full-html-check.ts';
import {browserCheck} from '../src/browser-check.ts';
import {canvasGame,domGame} from './canvas-fixtures.ts';
import {GenerationEngine} from '../src/live.ts';
import {GenerationJobs} from '../src/jobs.ts';
import {Store} from '../src/store.ts';
import {createApp} from '../src/api.ts';
import {spec,html} from './helpers.ts';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

test.beforeEach(({},info)=>test.skip(info.project.name!=='chromium-desktop','Production validator uses Chromium.'));

test('A1.8 rejects DOM-only games through the production HTML checker',async({browser})=>{
 await expect(checkFullHtml(browser,domGame,AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_CANVAS_REQUIRED'});
});

test('A1.8 lifecycle markers cannot bypass the rendering gate',async()=>{
 const source=html.replace('<main>','<main><div style="position:absolute;top:0;left:0;width:30px;height:30px;background:red">Sprite</div>');
 await expect(browserCheck(source,AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_DOM_GAME_WORLD'});
});

for(const kind of ['arcade','puzzle','webgl'])test('A1.8 accepts real offline '+kind+' with touch and DOM controls',async({browser})=>{
 const evidence=await checkFullHtml(browser,canvasGame(kind),AbortSignal.timeout(18000));
 expect(evidence.profiles).toEqual([320,390,844]);
 expect(evidence.rendering).toEqual({contract:'canvas-webgl-v1',contexts:[kind==='webgl'?'webgl':'2d'],profiles:[320,390,844]});
 expect(evidence.checks?.find(c=>c.aspect==='gameplay-observed')?.level).toBe('NOT_VERIFIED');
});

test('A1.8 production job edit, SQLite restart, historical export and offline reopen',async({browser})=>{
 test.setTimeout(60000);
 const directory=mkdtempSync('.local/canvas-chain-'),path=directory+'/test.sqlite';
 let source=canvasGame('puzzle'),calls=0;
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
  const app=createApp(store);
  expect(store.getVersion(version.versionId)).toEqual(version);expect(store.getVersion(historical.versionId)).toEqual(historical);
  expect(await(await app.request('/api/versions/'+historical.versionId+'/export')).text()).toBe(domGame);
  const exported=await(await app.request('/api/versions/'+version.versionId+'/export')).text();expect(exported).toBe(source);
  const offline=resolve(directory,'export.html');writeFileSync(offline,exported);
  const context=await browser.newContext({offline:true,hasTouch:true,viewport:{width:390,height:700}});
  try{
   const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(pathToFileURL(offline).href);await page.getByRole('button',{name:'Start',exact:true}).tap();
   await page.locator('canvas').tap();await expect(page.locator('output')).toHaveText('Steps 1');
   expect(errors).toEqual([]);
  }finally{await context.close();}
  // A real failed browser gate is retained in durable history, with no new
  // version, repair or second dispatch even when repair was enabled.
  source=domGame;
  const failed=await settled(jobs.create('owner','canvas-refusal',{spec,mode:'live',previousVersionId:version.versionId,telegramConsent:false}).jobId);
  expect(failed.stage).toBe('needs_attention');expect(failed.errorCode).toBe('BROWSER_CANVAS_REQUIRED');
  expect(failed.originalCheckpoint).toBe(domGame);expect(failed.validation?.level).toBe('FAILED');expect(calls).toBe(2);
  expect(store.history(historical.gameId)).toHaveLength(2);expect(failed.versionId).toBeNull();
  const refusedId=failed.jobId;
  await jobs.close();store.close();store=new Store(path);jobs=new GenerationJobs(store,engine);
  expect(jobs.get('owner',refusedId).errorCode).toBe('BROWSER_CANVAS_REQUIRED');
  jobs.continue('owner',refusedId);expect((await settled(refusedId)).stage).toBe('needs_attention');
  expect(calls).toBe(2);expect(store.history(historical.gameId)).toHaveLength(2);
 }finally{await jobs.close();engine.close();store.close();}
});
for(const [name,source,code] of [
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
] as const)test('A1.8 rejects '+name,async({browser})=>{
 await expect(checkFullHtml(browser,source,AbortSignal.timeout(18000))).rejects.toMatchObject({code});
});
