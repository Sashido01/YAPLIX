import {test,expect} from '@playwright/test';
import {browserCheck} from '../src/browser-check.ts';
import {GenerationEngine} from '../src/live.ts';
import {Store} from '../src/store.ts';
import {createApp} from '../src/api.ts';
import {html,spec} from './helpers.ts';

// Authored reductions of NL-004 geometry, not copies or repairs of its games.
function mobileLayout(kind:'direct'|'intent'|'fit'|'scroll'|'nested'|'states'|'decor'|'future'|'native'|'fixed'){
 const tall=kind==='direct'?420:kind==='intent'?360:100;
 return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
 *{box-sizing:border-box}body{margin:0;overflow:${kind==='scroll'?'auto':'hidden'}}
 main{width:100%;max-width:500px;margin:auto;padding:10px}.board{height:${tall}px}
 .pad{display:grid;grid-template-columns:repeat(3,60px);gap:10px}.key{width:60px;height:60px;cursor:pointer}
 @media(orientation:landscape){.board{height:${['fit','states','decor','future'].includes(kind)?100:kind==='nested'?100:kind==='fixed'?100:420}px}}
 ${kind==='nested'?'.scroller{height:150px;overflow:auto}.pad{margin-top:450px}':''}
 ${kind==='states'?'.later{display:none}.transparent{opacity:0}.invisible{visibility:hidden}':''}
 ${kind==='decor'?'.decoration{position:absolute;top:900px;cursor:pointer}':''}
 ${kind==='native'?'.key{display:none}button{display:block;margin-top:480px}':''}
 ${kind==='fixed'?'@media(orientation:landscape){.key{position:fixed;top:900px}}':''}
 </style></head><body><main><div class="board">Game</div><div class="scroller"><div class="pad">
 <div class="key">↑</div><div class="key">←</div><div class="key">↓</div><div class="key">→</div></div></div>
 ${kind==='native'?'<button>Action</button>':''}
 ${kind==='decor'?'<div class="decoration">Decoration</div>':''}
 ${kind==='future'?'<button style="position:absolute;top:900px">Future state</button>':''}
 ${kind==='states'?'<button class="later">Restart</button><button class="transparent" style="position:absolute;top:900px">Later</button><div aria-hidden="true" style="position:absolute;top:900px"><button>Future</button></div><button disabled style="position:absolute;top:900px">Disabled</button><button class="invisible" style="position:absolute;top:900px">Hidden</button><div inert style="position:absolute;top:900px"><button>Inactive</button></div>':''}
 </main><script>document.querySelectorAll('.key').forEach(e=>e.addEventListener('pointerdown',()=>{}));</script></body></html>`;
}

for(const kind of ['direct','intent','native','fixed'] as const)test('MICRO-030 rejects unreachable landscape controls: '+kind,async()=>{
 await expect(browserCheck(mobileLayout(kind),AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_CONTROLS_UNREACHABLE',profileWidth:844,profileHeight:390,validationPhase:'control-reachability'});
});
for(const kind of ['fit','scroll','nested','states','decor','future'] as const)test('MICRO-030 accepts reachable or inactive controls: '+kind,async()=>{
 const evidence=await browserCheck(mobileLayout(kind),AbortSignal.timeout(18000));
 expect(evidence.profiles).toEqual([320,390,844]);expect(evidence.elapsedMs).toBeLessThan(18000);
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
 const plain=html.replaceAll('data-yaplix-','data-custom-').replace('<main>','<main><canvas hidden></canvas><button disabled>Unavailable action</button>');
 const report=await browserCheck(plain,AbortSignal.timeout(18000));
 expect(report.scope).toBe('full-html');expect(report.checks?.find(c=>c.aspect==='html-runs')?.level).toBe('VERIFIED');
 for(const aspect of ['gameplay-observed','win-reachable','loss-reachable','restart-works'])expect(report.checks?.find(c=>c.aspect===aspect)?.level).toBe('NOT_VERIFIED');
 for(const fault of ['throw Error("startup");','Promise.reject(Error("promise"));'])await expect(browserCheck(plain.replace('draw();\nfunction emit',fault+'draw();\nfunction emit'),AbortSignal.timeout(18000))).rejects.toMatchObject({code:'JAVASCRIPT_EXCEPTION'});
 const restart=plain.replace('</main>','<button onclick="throw Error(\'restart\')">Restart</button></main>');
 await expect(browserCheck(restart,AbortSignal.timeout(18000))).rejects.toMatchObject({code:'JAVASCRIPT_EXCEPTION'});
});
test.beforeEach(({},info)=>test.skip(info.project.name!=='chromium-desktop','Server-side Chromium checker is independent of the frontend browser profile.'));
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
 .replace('function draw(){',`function draw(){document.querySelector('[data-yaplix-state]').textContent=JSON.stringify({score});`)
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
 const inert=html.replace(/point.onclick=\(\)=>\{[^\n]+/, 'point.onclick=()=>{};');
 const report=await browserCheck(inert,AbortSignal.timeout(18000));
 for(const aspect of ['input-works','gameplay-observed','win-reachable','loss-reachable','restart-works'])expect(report.checks?.find(c=>c.aspect===aspect)?.level).toBe('NOT_VERIFIED');
});

test('MICRO-022 safe format repair runs the actual browser then saves only its validated candidate',async()=>{
 test.setTimeout(20000);let calls=0;
 const raw=JSON.stringify(restartFixture.trim()),engine=new GenerationEngine([{route:'primary',provider:'synthetic',model:'fixture',readiness:async()=>'ready',complete:async()=>{calls++;return{code:raw,model:'fixture'};}}],{repairs:0});
 const store=new Store(':memory:');
 try{const checked=await engine.generate(spec);const v=store.save(spec,checked);expect(v.html).toBe(restartFixture.trim());expect(calls).toBe(1);expect(store.history(v.gameId)).toHaveLength(1);expect(v.generation?.browser.checks?.find(c=>c.aspect==='restart-works')?.level).toBe('VERIFIED');}finally{store.close();}
});
