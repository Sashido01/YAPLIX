import {test,expect} from '@playwright/test';
import {browserCheck} from '../src/browser-check.ts';
import {GenerationEngine} from '../src/live.ts';
import {Store} from '../src/store.ts';
import {createApp} from '../src/api.ts';
import {html,spec} from './helpers.ts';
import {checkFullHtml} from '../src/full-html-check.ts';
import {parseArtifact,type Artifact} from '../src/contracts.ts';
import {mkdtempSync} from 'node:fs';
import {GenerationJobs} from '../src/jobs.ts';
import {canvasGame} from './canvas-fixtures.ts';

// Authored reductions of NL-004 geometry, not copies or repairs of its games.
function mobileLayout(kind:'direct'|'intent'|'fit'|'scroll'|'nested'|'states'|'decor'|'future'|'native'|'fixed'){
 const tall=kind==='direct'?420:kind==='intent'?360:100;
 return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
 *{box-sizing:border-box}body{margin:0;overflow:${kind==='scroll'?'auto':'hidden'}}
 main{width:100%;max-width:500px;margin:auto;padding:10px}.board{height:${tall}px}canvas{width:100%;height:100px;display:block}
 .pad{display:grid;grid-template-columns:repeat(3,60px);gap:10px}.key{width:60px;height:60px;cursor:pointer}
 @media(orientation:landscape){.board{height:${['fit','states','decor','future'].includes(kind)?100:kind==='nested'?100:kind==='fixed'?100:420}px}}
 ${kind==='nested'?'.scroller{height:150px;overflow:auto}.pad{margin-top:450px}':''}
 ${kind==='states'?'.later{display:none}.transparent{opacity:0}.invisible{visibility:hidden}':''}
 ${kind==='decor'?'.decoration{position:absolute;top:900px;cursor:pointer}':''}
 ${kind==='native'?'.key{display:none}button{display:block;margin-top:480px}':''}
 ${kind==='fixed'?'@media(orientation:landscape){.key{position:fixed;top:900px}}':''}
 </style></head><body><main><div class="board"><canvas width="300" height="100"></canvas></div><div class="scroller"><div class="pad">
 <div class="key">↑</div><div class="key">←</div><div class="key">↓</div><div class="key">→</div></div></div>
 ${kind==='native'?'<button>Action</button>':''}
 ${kind==='decor'?'<div class="decoration">Decoration</div>':''}
 ${kind==='future'?'<button style="position:absolute;top:900px">Future state</button>':''}
 ${kind==='states'?'<button class="later">Restart</button><button class="transparent" style="position:absolute;top:900px">Later</button><div aria-hidden="true" style="position:absolute;top:900px"><button>Future</button></div><button disabled style="position:absolute;top:900px">Disabled</button><button class="invisible" style="position:absolute;top:900px">Hidden</button><div inert style="position:absolute;top:900px"><button>Inactive</button></div>':''}
 </main><script>const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');let step=0;function draw(){ctx.fillStyle='#142038';ctx.fillRect(0,0,300,100);ctx.fillStyle='#ffcc40';ctx.fillRect(20+(step++%3)*40,20,40,50);}draw();canvas.addEventListener('pointerdown',draw);document.querySelectorAll('.key').forEach(e=>e.addEventListener('pointerdown',draw));</script></body></html>`;
}

for(const kind of ['direct','intent','native','fixed'] as const)test('MICRO-030 rejects unreachable landscape controls: '+kind,async()=>{
 await expect(browserCheck(mobileLayout(kind),AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_CONTROLS_UNREACHABLE',profileWidth:844,profileHeight:390,validationPhase:'control-reachability'});
});
for(const kind of ['fit','scroll','nested','states','decor','future'] as const)test('MICRO-030 accepts reachable or inactive controls: '+kind,async()=>{
 const evidence=await browserCheck(mobileLayout(kind),AbortSignal.timeout(18000));
 expect(evidence.profiles).toEqual([320,390,844]);expect(evidence.elapsedMs).toBeLessThan(18000);
});

// An unknown Start label must not make the checker tap the canvas underneath
// its overlay. Controls become observable only after a real tap opens the game.
function coveredCanvas(clipped:boolean,label='Начать играть'){
 return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
 body{margin:0;overflow:hidden}canvas{display:block;width:100%;height:180px}button{min-height:48px}
 #cover{position:fixed;inset:0;display:grid;place-items:center;background:white}
 ${clipped?'@media(orientation:landscape){canvas{height:460px}}':''}
 </style></head><body><canvas></canvas><button id="action">Move</button>
 <div id="cover"><button id="launch">${label}</button></div><script>
 const surface=document.querySelector('canvas'),ctx=surface.getContext('2d');let step=0;function draw(){ctx.fillStyle='#142038';ctx.fillRect(0,0,300,150);ctx.fillStyle='#ffcc40';ctx.fillRect(20+(step++%3)*40,20,50,70);}draw();surface.addEventListener('pointerdown',draw);
 document.querySelector('#launch').onclick=()=>document.querySelector('#cover').remove();
 document.querySelector('#action').onclick=draw;
 </script></body></html>`;
}
for(const label of ['Начать играть','Launch session'])test('MICRO-032 overlay opens through reachable touch control: '+label,async()=>{
 const evidence=await browserCheck(coveredCanvas(false,label),AbortSignal.timeout(18000));
 expect(evidence.profiles).toEqual([320,390,844]);
 expect(evidence.checks?.find(c=>c.aspect==='gameplay-observed')?.level).toBe('NOT_VERIFIED');
});
test('MICRO-032 observes controls after opening overlay before proving landscape failure',async()=>{
 await expect(browserCheck(coveredCanvas(true),AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_CONTROLS_UNREACHABLE',profileWidth:844,profileHeight:390,validationPhase:'control-reachability'});
});

test('MICRO-030 engine reports FAILED and rejects the candidate without repair or real transport',async()=>{
 let calls=0;const diagnostics:{level:string;code:string}[]=[];
 const engine=new GenerationEngine([{route:'primary',provider:'synthetic',model:'fixture',readiness:async()=>'ready',complete:async()=>{calls++;return{code:mobileLayout('direct'),model:'fixture'};}}],{repairs:0});
 try{
  await expect(engine.generate(spec,undefined,undefined,AbortSignal.timeout(18000),{stage:()=>{},dispatch:()=>{},partial:()=>{},attempt:()=>{},validation:d=>diagnostics.push(d)})).rejects.toMatchObject({code:'BROWSER_CONTROLS_UNREACHABLE'});
  expect(diagnostics).toContainEqual(expect.objectContaining({level:'FAILED',code:'BROWSER_CONTROLS_UNREACHABLE'}));expect(calls).toBe(1);
 }finally{engine.close();}
});

test('MICRO-023 arbitrary full HTML runs without telemetry or fixed selectors; critical errors still fail',async()=>{
 test.setTimeout(40000);
 const plain=canvasGame().replace('<body>','<body><button disabled>Unavailable action</button>').replace('</body>','<canvas style="display:none"></canvas></body>');
 const report=await browserCheck(plain,AbortSignal.timeout(18000));
 expect(report.scope).toBe('full-html');expect(report.checks?.find(c=>c.aspect==='html-runs')?.level).toBe('VERIFIED');
 for(const aspect of ['gameplay-observed','win-reachable','loss-reachable','restart-works'])expect(report.checks?.find(c=>c.aspect===aspect)?.level).toBe('NOT_VERIFIED');
 for(const fault of ['throw Error("startup");','Promise.reject(Error("promise"));'])await expect(browserCheck(plain.replace('</script>',fault+'</script>'),AbortSignal.timeout(18000))).rejects.toMatchObject({code:'JAVASCRIPT_EXCEPTION'});
 const restart=plain.replace('</body>','<button onclick="throw Error(\'restart\')">Restart</button></body>');
 await expect(browserCheck(restart,AbortSignal.timeout(18000))).rejects.toMatchObject({code:'JAVASCRIPT_EXCEPTION'});
});
test.beforeEach(({},info)=>test.skip(info.project.name!=='chromium-desktop','Server-side Chromium checker is independent of the frontend browser profile.'));

test('MICRO-036.3 real Full HTML evidence survives parse, save and reopened version',async({browser})=>{
 const source=mobileLayout('fit');
 const viewports=new Map<string,{width:number;height:number}>();
 // Observe real pages without replacing the checker, browser or context factory.
 const observe=()=>{for(const context of browser.contexts())for(const page of context.pages()){const size=page.viewportSize();if(size)viewports.set(JSON.stringify(size),size);}};
 const timer=setInterval(observe,10);
 let evidence;
 try{evidence=await checkFullHtml(browser,source,AbortSignal.timeout(18000));}finally{clearInterval(timer);}
 expect([...viewports.values()]).toEqual([{width:320,height:700},{width:390,height:700},{width:844,height:390}]);
 expect(evidence.profiles).toEqual([320,390,844]);
 const candidate:Artifact={html:source,method:'llm_code',provider:'offline-test',model:'authored',generationStatus:'succeeded',validationStatus:'passed',generation:{attempts:[{route:'primary',provider:'offline-test',requestedModel:'authored',model:'authored',outcome:'accepted',errorCode:null,elapsedMs:0}],fallback:false,elapsedMs:0,browser:evidence}};
 const artifact=parseArtifact(candidate);
 const directory=mkdtempSync('.local/metadata-integration-'),path=directory+'/versions.sqlite';
 let store=new Store(path);
 try{
  const seed=store.save(spec,artifact);
  // Seed pre-MICRO-030 metadata in the isolated test DB; production saves now
  // require current evidence, while reading old rows remains compatible.
  store.db.prepare("UPDATE versions SET metadata=json_set(metadata,'$.generation.browser.profiles',json('[320,390]')) WHERE version_id=?").run(seed.versionId);
  const old=store.getVersion(seed.versionId);
  const saved=store.save(spec,artifact,old.versionId);
  expect(saved.generation!.browser).toEqual(evidence);
  expect(saved.gameId).toBe(old.gameId);expect(saved.previousVersionId).toBe(old.versionId);expect(saved.versionId).not.toBe(old.versionId);
  store.close();store=new Store(path);
  expect(store.getVersion(saved.versionId)).toEqual(saved);
  expect(store.getVersion(old.versionId)).toEqual(old);
  expect(store.getVersion(old.versionId).generation!.browser.profiles).toEqual([320,390]);
  expect(store.history(old.gameId).map(v=>v.versionId)).toEqual([old.versionId,saved.versionId]);
  expect(saved.html).toBe(source);expect(saved.sha256).toBe(old.sha256);
  const app=createApp(store);
  expect(await(await app.request('/api/versions/'+old.versionId)).json()).toEqual(old);
  const history=await(await app.request('/api/games/'+old.gameId)).json();
  expect(history.versions[0].generation.browser.profiles).toEqual([320,390]);
  expect(await(await app.request('/api/versions/'+old.versionId+'/export')).text()).toBe(source);
 }finally{store.close();}
});

test('MICRO-036.3 offline production engine job saves, lists, reopens, exports and recovers checkpoint with one dispatch',async()=>{
 test.setTimeout(60000);
 const source=mobileLayout('fit');let calls=0;
 const engine=new GenerationEngine([{route:'primary',provider:'ollama.com',model:'gemma4:31b',readiness:async()=>'ready',complete:async()=>{calls++;return{code:source,model:'gemma4:31b'};}}]);
 const path=mkdtempSync('.local/metadata-job-')+'/versions.sqlite';
 let store=new Store(path),jobs=new GenerationJobs(store,engine),app=createApp(store,engine,undefined,undefined,undefined,undefined,jobs);
 const settled=async(id:string)=>{await expect.poll(async()=>{const response=await app.request('/api/jobs/'+id);return(await response.json()).stage;},{timeout:25000}).toMatch(/^(completed|needs_attention|failed)$/);return(await(await app.request('/api/jobs/'+id)).json());};
 try{
  const response=await app.request('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idempotencyKey:'offline-metadata-chain',spec,mode:'live',providerMode:'ollama-cloud'})});
  expect(response.status).toBe(202);const created=await response.json(),done=await settled(created.jobId);
  expect(done.stage).toBe('completed');expect(done.errorCode).toBeNull();expect(done.attempts).toBe(1);expect(calls).toBe(1);
  expect(done.checkpoint).toBe(source);expect(done.originalCheckpoint).toBe(source);
  expect(done.checkpointOrigin).toEqual({provider:'ollama.com',requestedModel:'gemma4:31b',model:'gemma4:31b'});
  const saved=await(await app.request('/api/versions/'+done.versionId)).json();
  expect(saved.generation.browser).toMatchObject({scope:'full-html',profiles:[320,390,844],offline:true,errors:0});
  expect(saved.html).toBe(source);
  expect((await(await app.request('/api/games')).json()).games.map((v:any)=>v.versionId)).toEqual([saved.versionId]);
  const history=await(await app.request('/api/games/'+saved.gameId)).json();
  expect(history.versions).toHaveLength(1);expect(history.versions[0].generation).toEqual(saved.generation);
  expect(await(await app.request('/api/versions/'+saved.versionId+'/export')).text()).toBe(source);
  await jobs.close();store.close();store=new Store(path);jobs=new GenerationJobs(store,engine);app=createApp(store,engine,undefined,undefined,undefined,undefined,jobs);
  expect(await(await app.request('/api/versions/'+saved.versionId)).json()).toEqual(saved);
  expect((await(await app.request('/api/jobs/'+done.jobId)).json()).originalCheckpoint).toBe(source);
  expect(calls).toBe(1);

  // A separate durable fixture represents a crash after response/checkpoint,
  // before saving. Cancel it synchronously so no provider request can start.
  const recovery=jobs.create('owner','offline-checkpoint-recovery',{spec,mode:'live',providerMode:'ollama-cloud',telegramConsent:false});
  jobs.cancel('owner',recovery.jobId);await jobs.close();
  const row=store.db.prepare('SELECT metadata FROM generation_jobs WHERE job_id=?').get(recovery.jobId)!;
  const metadata={...JSON.parse(String(row.metadata)),provider:done.provider,requestedModel:done.requestedModel,actualModel:done.actualModel,checkpointOrigin:done.checkpointOrigin,originalCheckpoint:source,errorCode:null};
  store.db.prepare("UPDATE generation_jobs SET status='validating',attempts=1,checkpoint=?,metadata=? WHERE job_id=?").run(source,JSON.stringify(metadata),recovery.jobId);
  store.close();store=new Store(path);jobs=new GenerationJobs(store,engine,undefined,true,{retryMs:10});app=createApp(store,engine,undefined,undefined,undefined,undefined,jobs);
  const recovered=await settled(recovery.jobId);
  expect(recovered.stage).toBe('completed');expect(recovered.errorCode).toBeNull();expect(calls).toBe(1);expect(recovered.attempts).toBe(1);
  const restored=await(await app.request('/api/versions/'+recovered.versionId)).json();
  expect(restored.generation.browser.profiles).toEqual([320,390,844]);expect(restored.html).toBe(source);
  expect(restored.generation.attempts[0].requestMs).toBe(0);
  expect(await(await app.request('/api/versions/'+saved.versionId)).json()).toEqual(saved);
 }finally{await jobs.close();engine.close();store.close();}
});
test('real checker accepts authored fixture at 320/390 and offline',async()=>{
 const evidence=await browserCheck(html,AbortSignal.timeout(18000));
 expect(evidence).toMatchObject({profiles:[320,390],offline:true,errors:0,scope:'startup-input-pause',levels:['HTML_VALID','JS_EXECUTABLE','UI_VISIBLE','MOBILE_VERIFIED']});
 expect(evidence.checks?.find(c=>c.aspect==='win-reachable')?.level).toBe('NOT_VERIFIED');
});
test('real checker rejects zero-height controls, fatal JS, autostart, duplicate start and network attempts',async()=>{
 test.setTimeout(45000);
 const cases=[
  [html.replace('min-height:48px','min-height:0;height:0;padding:0;overflow:hidden'),'BROWSER_MOBILE_LAYOUT'],
  [html.replace('window.addEventListener(\'resize\',draw);draw();','throw new Error("missing-state");'),'JAVASCRIPT_EXCEPTION'],
  [html.replace("emit('game_ready');","emit('game_ready');emit('game_started');"),'BROWSER_AUTOSTART'],
  [html.replace('paused=!paused;','emit("game_started");paused=!paused;'),'BROWSER_DUPLICATE_START'],
  [html.replace("draw();emit('score_changed'","document.body.appendChild(Object.assign(document.createElement('img'),{src:'https://blocked.test/pixel'}));draw();emit('score_changed'"),'BROWSER_CONSOLE_ERROR']
 ];
 for(const [bad,code] of cases)await expect(browserCheck(bad,AbortSignal.timeout(18000))).rejects.toMatchObject({code});
});
test('production API real browser rejection repairs only once and persists no broken version',async()=>{
 test.setTimeout(30000);let calls=0;const broken=html.replace('paused=!paused;','emit("game_started");paused=!paused;');
 const engine=new GenerationEngine([{route:'primary',provider:'synthetic',model:'test',readiness:async()=>'ready',complete:async()=>({code:++calls===1?broken:html,model:'test-actual'})}],{timeoutMs:20000});
 const store=new Store(':memory:');try{
  const response=await createApp(store,engine).request('/api/games',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({spec,mode:'live'})});expect(response.status).toBe(201);const result=await response.json();expect(result.generation.attempts.map((a:any)=>a.outcome)).toEqual(['rejected','accepted']);expect(store.list()).toHaveLength(1);expect(store.history(result.gameId)).toHaveLength(1);expect(result.html).toBe(html.trim());
 }finally{engine.close();store.close();}
});

test('MICRO-022 runtime failures at startup, on input, promise rejection and destroyed field block readiness',async()=>{
 test.setTimeout(45000);
 const cases=[
  [html.replace('let score=0','let score=; let other=0'),'JAVASCRIPT_EXCEPTION'],
  [html.replace('window.addEventListener(\'resize\',draw);draw();','throw Error("startup fixture");'),'JAVASCRIPT_EXCEPTION'],
  [html.replace('document.querySelector(\'#score\').textContent=String(++score);','throw Error("input fixture");'),'JAVASCRIPT_EXCEPTION'],
  [html.replace('document.querySelector(\'#score\').textContent=String(++score);','Promise.reject(Error("promise fixture"));'),'JAVASCRIPT_EXCEPTION'],
  [html.replace('point.disabled=trap.disabled=false','point.disabled=trap.disabled=true'),'BROWSER_INPUT_DISABLED'],
  [html.replace("draw();emit('score_changed'","canvas.remove();emit('score_changed'"),'BROWSER_GAME_AREA'],
 ];
 for(const [bad,code]of cases)await expect(browserCheck(bad,AbortSignal.timeout(18000))).rejects.toMatchObject({code});
});

const restartFixture=html.replace('<p id="status">','<button data-yaplix-restart id="restart">Restart</button><output data-yaplix-state></output><p id="status">')
 .replace('</style>','@media(orientation:landscape){h1,p{margin:4px 0}main{padding:4px}}</style>')
 .replace('function draw(){',`function draw(){document.querySelector('[data-yaplix-state]').textContent=JSON.stringify({score});`)
 // Restart at score zero must still present a game field, not an empty bitmap.
 .replace("ctx.fillStyle='#ffd000';","ctx.fillStyle='#223344';ctx.fillRect(0,0,width,48);ctx.fillStyle='#6688aa';ctx.fillRect(width-24,0,24,48);ctx.fillStyle='#ffd000';")
 .replace('</script>',`document.querySelector('#restart').onclick=()=>{score=0;active=true;point.disabled=trap.disabled=false;start.disabled=true;draw();};</script>`);

test('MICRO-022 repeat run uses real restart and input; a no-op or crashing restart is rejected',async()=>{
 test.setTimeout(45000);
 const checked=await browserCheck(restartFixture,AbortSignal.timeout(18000));
 expect(checked.checks?.find(c=>c.aspect==='restart-works')?.level).toBe('VERIFIED');
 for(const bad of [restartFixture.replace('score=0;active=true;point.disabled=trap.disabled=false;start.disabled=true;draw();',''),restartFixture.replace("document.querySelector('#restart').onclick=()=>{","document.querySelector('#restart').onclick=()=>{throw Error('restart fixture');")]){
  await expect(browserCheck(bad,AbortSignal.timeout(18000))).rejects.toMatchObject({code:bad.includes('restart fixture')?'JAVASCRIPT_EXCEPTION':'BROWSER_RESTART_FAILED'});
 }
});

test('MICRO-022 unknown mechanics never earn gameplay or win VERIFIED from pixels or HTML text',async()=>{
 test.setTimeout(20000);
 const report=await browserCheck(canvasGame(),AbortSignal.timeout(18000));
 for(const aspect of ['input-works','gameplay-observed','win-reachable','loss-reachable','restart-works'])expect(report.checks?.find(c=>c.aspect===aspect)?.level).toBe('NOT_VERIFIED');
});

test('MICRO-022 safe format repair runs the actual browser then saves only its validated candidate',async()=>{
 test.setTimeout(20000);let calls=0;
 const raw=JSON.stringify(restartFixture.trim()),engine=new GenerationEngine([{route:'primary',provider:'synthetic',model:'fixture',readiness:async()=>'ready',complete:async()=>{calls++;return{code:raw,model:'fixture'};}}],{repairs:0});
 const store=new Store(':memory:');
 try{const checked=await engine.generate(spec);const v=store.save(spec,checked);expect(v.html).toBe(restartFixture.trim());expect(calls).toBe(1);expect(store.history(v.gameId)).toHaveLength(1);expect(v.generation?.browser.checks?.find(c=>c.aspect==='restart-works')?.level).toBe('VERIFIED');}finally{store.close();}
});
