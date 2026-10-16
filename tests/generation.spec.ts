import {test,expect} from '@playwright/test';
import {browserCheck} from '../src/browser-check.ts';
import {GenerationEngine} from '../src/live.ts';
import {Store} from '../src/store.ts';
import {createApp} from '../src/api.ts';
import {html,spec} from './helpers.ts';
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
