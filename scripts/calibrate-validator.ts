import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {browserCheck} from '../src/browser-check.ts';
import {prepareDocument} from '../src/validation.ts';
import {validateDocument} from '../src/generation.ts';
import {GAME_CSP,UUID_COMPAT} from '../src/runtime.ts';
import {calibrationDocuments} from '../tests/calibration-fixtures.ts';
import {calibrationOracle} from '../tests/calibration-oracle.ts';
import type {Page,Frame} from 'playwright-core';
const {chromium}=await import('playwright-core');
const stage=process.argv[2];if(!['before','after','oracle'].includes(stage))throw Error('Use before, after or oracle');
const attempt=process.argv[3]??'';if(attempt&&!/^attempt\d+$/.test(attempt))throw Error('Invalid attempt');
const root=resolve('.local/micro028'),out=resolve(root,stage+(attempt?'-'+attempt:''));mkdirSync(out,{recursive:true});
if(existsSync(resolve(out,'results.json')))throw Error('Evidence exists; preserve the first run. Use a new explicit attempt directory in code.');
const write=(name:string,data:unknown)=>writeFileSync(resolve(out,name),JSON.stringify(data,null,2)+'\n');
type Verdict='VERIFIED'|'FAILED'|'NOT_VERIFIED'|'CHECKER_ERROR';
const results:any[]=[];
for(let index=0;index<calibrationDocuments.length;index++){
 const html=calibrationDocuments[index]!,id=String(index+1).padStart(2,'0');
 writeFileSync(resolve(out,id+'.html'),html);
 const expected=index%3===0?'VERIFIED':'FAILED',began=performance.now();
 if(stage!=='oracle'){
  try{
   const prepared=prepareDocument(html);assert.deepEqual(validateDocument(prepared.html),[]);
   const evidence=await browserCheck(prepared.html,AbortSignal.timeout(18000));
   const verdict:Verdict=evidence.checks?.length===6&&evidence.checks.every(c=>c.level==='VERIFIED')?'VERIFIED':'NOT_VERIFIED';
   results.push({id,expected,verdict,technicalGate:'PASSED',reason:'Per-aspect evidence; technical pass is not gameplay verification',evidence});
  }catch(error){const e=error as any,code=e.code??'UNEXPECTED_CHECKER_ERROR';const verdict:Verdict=/INSTALL_REQUIRED|SANDBOX|CHECKER_ERROR|STARTUP_FAILED|UNEXPECTED/.test(code)?'CHECKER_ERROR':/TIMEOUT|CANCELLED|INCONCLUSIVE/.test(code)?'NOT_VERIFIED':'FAILED';results.push({id,expected,verdict,code,feedback:e.feedback??null,phase:e.validationPhase??null,profileWidth:e.profileWidth??null});}
 }else{
  const browser=await chromium.launch({channel:'chromium',chromiumSandbox:true,headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,offline:true});
  await context.tracing.start({screenshots:true,snapshots:true,sources:false});
  const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  let frame:Frame;const observations:any[]=[];
  const observe=async()=>{const s=await frame.locator('#hud').textContent();return s?JSON.parse(s):null;};
  const click=async(selector:string,touch:boolean)=>{if(touch)await frame.locator(selector).tap();else await frame.locator(selector).click();};
  const start=async(touch:boolean)=>{await click('#start',touch);return observe();};
  const input=async(action:string,touch:boolean)=>{if(touch)await click(/^\d$/.test(action)?'[aria-label="Cell '+action+'"]':'[data-action="'+action+'"]',true);else{await frame.locator('canvas').click();await page.keyboard.press(/^\d$/.test(action)?'Digit'+action:action==='step'?'Space':'Arrow'+action[0]!.toUpperCase()+action.slice(1));}observations.push({action,touch,state:await observe()});};
  const sequence=async(actions:string[],touch:boolean)=>{for(const a of actions)await input(a,touch);};
  const oracle=calibrationOracle[Math.floor(index/3)]!;let verdict:Verdict='VERIFIED',reason='';const modes:any[]=[];
  try{
   await page.setContent('<style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe sandbox="allow-scripts"></iframe>');
   await page.locator('iframe').evaluate((node,content)=>{(node as HTMLIFrameElement).srcdoc=content;},'<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="'+GAME_CSP+'"><script>'+UUID_COMPAT+'</script>'+html);
   frame=(await (await page.locator('iframe').elementHandle())!.contentFrame())!;await frame.waitForURL('about:srcdoc');
   for(const touch of [false,true]){
    const initial=await start(touch);assert.equal(initial.phase,'playing');
    await sequence(oracle.win,touch);const won=await observe();await page.screenshot({path:resolve(out,id+(touch?'-touch':'-keyboard')+'.png')});
    if(index%3===0){assert.equal(won.phase,'won');assert.equal(won.score,Math.floor(index/3)===4?1:Math.floor(index/3)===1?6:3);assert.equal(await frame.locator('#result').textContent(),'won');
     assert(observations.some(o=>o.touch===touch&&o.state.turn>0),'Real input changes world/turn');
     await click('#restart',touch);assert.deepEqual(await observe(),initial,'Restart restores the complete initial world');
     await sequence(oracle.loss,touch);const lost=await observe();assert.equal(lost.phase,'lost');assert(lost.health<=0);assert.equal(await frame.locator('#result').textContent(),'lost');await click('#restart',touch);assert.deepEqual(await observe(),initial);modes.push({input:touch?'touch':'keyboard',start:true,progress:won.score,win:true,loss:true,restart:true});
    }else{
     const variant=index%3,genre=Math.floor(index/3);
     if(genre===0&&variant===1){assert.equal(won.x,initial.x);assert.equal(won.score,0);}
     if(genre===0&&variant===2){assert.equal(won.score,3);assert.equal(won.items.length,0);assert.equal(won.phase,'playing');}
     if(genre===1&&variant===1){assert(errors.includes('Cannot select cell'));assert.equal(won.score,0);}
     if(genre===1&&variant===2){await start(touch);await sequence(['0','1'],touch);const stalled=await observe();assert.equal(stalled.phase,'resolving');const before=JSON.stringify(stalled);await input('0',touch);assert.equal(JSON.stringify(await observe()),before);}
     if(genre===2&&variant===1){assert.equal(won.items.length,0);assert.equal(won.score,0);assert.equal(won.phase,'playing');}
     if(genre===2&&variant===2){assert.equal(won.phase,'won');await click('#restart',touch);assert.deepEqual(await observe(),won);}
     if(genre===3){await start(touch);await sequence(oracle.loss,touch);const s=await observe();if(variant===1){assert.equal(s.health,0);assert.equal(s.phase,'playing');}else{assert.equal(s.health,1);assert.equal(s.score,1);}}
     if(genre===4&&variant===1){assert.equal(won.bricks.length,1);assert.equal(won.score,1);assert.equal(won.phase,'playing');}
     if(genre===4&&variant===2){assert.equal(won.bricks.length,0);assert.equal(won.score,1);assert.equal(won.phase,'playing');}
     modes.push({input:touch?'touch':'keyboard',defectReproduced:oracle.defects[variant-1]});
    }
   }
   verdict=expected as Verdict;reason=index%3===0?'Independent actions reached win, loss and reset world on both input modes':oracle.defects[index%3-1]!;
  }catch(e){verdict='CHECKER_ERROR';reason=(e as Error).message;}
  finally{await context.tracing.stop({path:resolve(out,id+'.zip')});await browser.close();}
  results.push({id,expected,verdict,reason,modes,observations,errors});
 }
 results.at(-1).elapsedMs=Math.round(performance.now()-began);results.at(-1).sha256=createHash('sha256').update(html).digest('hex');
 write('results.json',results);console.log(id,results.at(-1).verdict,results.at(-1).code??results.at(-1).reason);
}
if(stage!=='oracle'){
 const count=(predicate:(r:any)=>boolean)=>results.filter(predicate).length;
 const times=results.map(r=>r.elapsedMs).sort((a,b)=>a-b);
 write('metrics.json',{convention:'Positive means defective: TP=defective FAILED, TN=good VERIFIED. Unknowns remain in denominators.',total:results.length,falseAccept:{n:count(r=>r.expected==='FAILED'&&r.verdict==='VERIFIED'),d:10},falseReject:{n:count(r=>r.expected==='VERIFIED'&&r.verdict==='FAILED'),d:5},inconclusive:{n:count(r=>r.verdict==='NOT_VERIFIED'),d:15},checkerError:{n:count(r=>r.verdict==='CHECKER_ERROR'),d:15},truePositive:{n:count(r=>r.expected==='FAILED'&&r.verdict==='FAILED'),d:10},trueNegative:{n:count(r=>r.expected==='VERIFIED'&&r.verdict==='VERIFIED'),d:5},determinate:{n:count(r=>['VERIFIED','FAILED'].includes(r.verdict)),d:15},medianMs:times[7],technicalAccepts:count(r=>r.technicalGate==='PASSED')});
}
if(results.some(r=>r.verdict==='CHECKER_ERROR'))process.exitCode=1;
