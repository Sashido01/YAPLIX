import {test,expect} from '@playwright/test';
import {browserCheck} from '../src/browser-check.ts';
import {GenerationEngine} from '../src/live.ts';
import {Store} from '../src/store.ts';
import {createApp} from '../src/api.ts';
import {html,spec} from './helpers.ts';
test.beforeEach(({},info)=>test.skip(info.project.name!=='chromium-desktop','Server-side Chromium checker is independent of the frontend browser profile.'));
test('real checker accepts authored fixture at 320/390 and offline',async()=>{
 expect(await browserCheck(html,AbortSignal.timeout(18000))).toEqual({profiles:[320,390],offline:true,errors:0,scope:'startup-input-pause'});
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
