import {resolveBrowserTarget} from './browser-target.ts';
import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { parseEvent, Fault } from './contracts.ts';
import { GAME_CSP, UUID_COMPAT } from './runtime.ts';
import { PROJECT_ROOT } from './store.ts';
import {configureBrowserTempRoot} from './browser-temp.ts';
import { summarizeSession } from './orchestrator/gameplay-check.ts';
import { checkFullHtml } from './full-html-check.ts';
import type { BrowserEvidence } from './contracts.ts';
import {BROWSER_VIEWPORTS,BROWSER_PROFILES} from './browser-profiles.ts';
import {BROWSER_STORAGE_INIT_SCRIPT,BROWSER_STORAGE_MARKER,browserStorageFeedback,browserStorageName} from './browser-storage-guard.ts';
import {browserPhaseTracker} from './browser-phase.ts';
import {awaitWithAbort} from './abortable.ts';
import type { TraceData } from './generation-trace.ts';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(PROJECT_ROOT,'.local/playwright');
const {chromium}=await import('playwright-core');

export type { BrowserEvidence } from './contracts.ts';
export const VALIDATION_BUDGETS = Object.freeze({ totalMs:18000, startupMs:8000, bridgeMs:1000, renderMs:3500, criticalMs:100, interactionMs:6000, restartMs:2500 });
export class BrowserFailure extends Fault {
  readonly feedback:string;
  constructor(code:string,feedback:string){super(code,502);this.feedback=feedback.slice(0,512);}
}
export function checkerReady() { return resolveBrowserTarget(chromium.executablePath()).ready; }
export async function browserCheck(html: string, signal: AbortSignal, options:{trace?:(event:string,data?:TraceData)=>void;saveSnapshot?:(viewport:string,image:Uint8Array)=>{captureId:string;sha256:string}|void}={}): Promise<BrowserEvidence> {
  const began=performance.now();let phase='startup';
  const trace=(event:string,data:TraceData={})=>{try{options.trace?.(event,data);}catch{/* Diagnostics must never change validation. */}};
  if(signal.aborted)throw new Fault('REQUEST_CANCELLED',499);
  const temp=configureBrowserTempRoot();
  const target=resolveBrowserTarget(chromium.executablePath()),channel=target.channel,executable=target.executablePath,ready=target.ready;
  if (!ready){trace('browser.launch.failed',{status:'NOT_VERIFIED',errorCode:'BROWSER_INSTALL_REQUIRED',details:{nodeVersion:process.versions.node,browserTarget:channel,browserChannel:channel,browserExecutable:executable.split(/[\\/]/).at(-1),browserExecutableExists:existsSync(executable),browserReady:false,sandboxEnabled:true}});throw new Fault('BROWSER_INSTALL_REQUIRED',503);}
  const deadline=AbortSignal.any([signal,AbortSignal.timeout(VALIDATION_BUDGETS.totalMs)]);
  const env=Object.fromEntries(['LD_LIBRARY_PATH','PATH','Path','SystemRoot','TEMP','TMP','TMPDIR','HOME','USERPROFILE','LOCALAPPDATA','DISPLAY','WAYLAND_DISPLAY','XDG_RUNTIME_DIR','LANG'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]!]));
  // Chromium's supported root-owned helper preserves its sandbox on Ubuntu's
  // restricted user namespaces. Never change AppArmor or use --no-sandbox.
  if(process.platform==='linux'){
    const helper=process.env.CHROME_DEVEL_SANDBOX??'/opt/google/chrome/chrome-sandbox';
    if(existsSync(helper)){
      const info=statSync(helper);
      if(!info.isFile()||info.uid!==0||(info.mode&0o4000)===0||(info.mode&0o022)!==0){trace('browser.launch.failed',{status:'FAIL',errorCode:'BROWSER_SANDBOX_CONFIGURATION',details:{nodeVersion:process.versions.node,browserTarget:channel,browserChannel:channel,sandboxEnabled:true,sandboxHelperUid:info.uid,sandboxHelperMode:(info.mode&0o7777).toString(8)}});throw new Fault('BROWSER_SANDBOX_CONFIGURATION',503);}
      env.CHROME_DEVEL_SANDBOX=helper;
      trace('browser.launch.started',{details:{nodeVersion:process.versions.node,browserTarget:channel,browserChannel:channel,browserExecutable:executable.split(/[\\/]/).at(-1),browserExecutableExists:true,browserReady:true,sandboxEnabled:true,sandboxHelper:'verified',sandboxHelperUid:info.uid,sandboxHelperMode:(info.mode&0o7777).toString(8),tempProfileReady:existsSync(temp)}});
    }else if(process.env.CHROME_DEVEL_SANDBOX){trace('browser.launch.failed',{status:'FAIL',errorCode:'BROWSER_SANDBOX_CONFIGURATION',details:{nodeVersion:process.versions.node,browserTarget:channel,browserChannel:channel,sandboxEnabled:true,sandboxHelper:'configured_missing'}});throw new Fault('BROWSER_SANDBOX_CONFIGURATION',503);}
    else trace('browser.launch.started',{details:{nodeVersion:process.versions.node,browserTarget:channel,browserChannel:channel,browserExecutable:executable.split(/[\\/]/).at(-1),browserExecutableExists:true,browserReady:true,sandboxEnabled:true,sandboxHelper:'absent',tempProfileReady:existsSync(temp)}});
  }else trace('browser.launch.started',{details:{nodeVersion:process.versions.node,browserTarget:channel,browserChannel:channel,browserExecutable:executable.split(/[\\/]/).at(-1),browserExecutableExists:true,browserReady:true,sandboxEnabled:true,tempProfileReady:existsSync(temp)}});
  const browserArgs=channel==='chrome'?{executablePath:executable}:{channel};
  const launch=chromium.launch({...browserArgs,headless:true,chromiumSandbox:true,timeout:VALIDATION_BUDGETS.startupMs,env});
  const cancelLaunch=()=>void launch.then(b=>b.close()).catch(()=>{});
  deadline.addEventListener('abort',cancelLaunch,{once:true});
  let browser;
  try{browser=await launch;trace('browser.launch.completed',{status:'PASS',durationMs:Math.round(performance.now()-began),details:{nodeVersion:process.versions.node,browserTarget:channel,browserChannel:channel,browserExecutable:executable.split(/[\\/]/).at(-1),browserReady:true,sandboxEnabled:true}});}catch(error){
    const message=error instanceof Error?error.message:String(error),timedOut=deadline.aborted&&!signal.aborted;
    const code=signal.aborted?'REQUEST_CANCELLED':timedOut?'BROWSER_TIMEOUT_STARTUP':/Socket path too long|ENAMETOOLONG/i.test(message)?'BROWSER_TEMP_PATH_TOO_LONG':/Executable doesn't exist|browserType\.launch: Executable/i.test(message)?'BROWSER_INSTALL_REQUIRED':/EACCES|permission denied|Access is denied/i.test(message)?'BROWSER_SANDBOX_CONFIGURATION':'BROWSER_SANDBOX_UNAVAILABLE';
    const category=/Socket path too long|ENAMETOOLONG/i.test(message)?'temp_path_too_long':/Executable doesn't exist|Executable.*missing/i.test(message)?'executable_missing':/EACCES|permission denied|Access is denied/i.test(message)?'permission_denied':/sandbox|namespace|setuid/i.test(message)?'sandbox_denied':timedOut?'startup_timeout':'launch_failed';
    trace('browser.launch.failed',{status:code.includes('TIMEOUT')?'NOT_VERIFIED':code==='BROWSER_INSTALL_REQUIRED'?'NOT_VERIFIED':'FAIL',durationMs:Math.round(performance.now()-began),errorCode:code,details:{nodeVersion:process.versions.node,browserTarget:channel,browserChannel:channel,browserExecutable:executable.split(/[\\/]/).at(-1),browserExecutableExists:existsSync(executable),browserReady:ready,sandboxEnabled:true,launchErrorCategory:category,launchError:message}});
    throw Object.assign(new Fault(code,503),{feedback:message.slice(0,512),launchErrorCategory:category});
  }
  finally{deadline.removeEventListener('abort',cancelLaunch);}
  const abort=()=>void browser.close().catch(()=>{});deadline.addEventListener('abort',abort,{once:true});
  if(deadline.aborted)abort();
  try {
    // Existing instrumented games retain their stricter lifecycle checks.
    if(!/data-yaplix-start\b/.test(html)){phase='full_html';return await checkFullHtml(browser,html,deadline,trace,options.saveSnapshot);}
    let checks:BrowserEvidence['checks'];
    for(const {width,height} of BROWSER_VIEWPORTS['startup-input-pause']) {
      trace('browser.viewport.started',{details:{viewport:`${width}x${height}`,deviceScaleFactor:2}});
      if(deadline.aborted)throw new Fault('BROWSER_TIMEOUT',504);
      const phases=browserPhaseTracker(trace,`${width}x${height}`);phases.start('document-boot');
      const context=await awaitWithAbort(browser.newContext({viewport:{width,height},deviceScaleFactor:2,hasTouch:true,isMobile:true,offline:true,serviceWorkers:'block',acceptDownloads:false}),deadline,()=>new Fault(signal.aborted?'REQUEST_CANCELLED':'BROWSER_TIMEOUT',signal.aborted?499:504),context=>context.close());
      await context.addInitScript(BROWSER_STORAGE_INIT_SCRIPT);
      phase='render';let phaseBudgetExceeded=false;let profileChecks:BrowserEvidence['checks'];const page=await context.newPage();page.setDefaultTimeout(VALIDATION_BUDGETS.renderMs);const errors:string[]=[];
      let exception='';page.on('pageerror',error=>{const storage=browserStorageName(error.message);errors.push(storage?'BROWSER_STORAGE_ACCESS_FORBIDDEN':'JAVASCRIPT_EXCEPTION');exception=storage?browserStorageFeedback(storage):error.message.slice(0,250);});
      page.on('console',message=>{if(message.type()==='error')errors.push('BROWSER_CONSOLE_ERROR');});
      page.on('dialog',dialog=>{errors.push('NATIVE_DIALOG');void dialog.dismiss();});
      context.on('page',popup=>{if(popup!==page){errors.push('POPUP');void popup.close();}});
      await context.route('**/*',route=>{errors.push('NETWORK_ATTEMPT');return route.abort();});
      try {
        const session={sessionId:randomUUID(),versionId:randomUUID()};
        await page.setContent('<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe id="check" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>');
        await page.evaluate(({html,session,csp,compat})=>{
          const frame=document.querySelector('iframe')!;(window as any).checkEvents=[];
          addEventListener('message',e=>{if(e.source===frame.contentWindow&&e.origin==='null'&&e.data?.channel==='yaplix'&&(window as any).checkEvents.length<128)(window as any).checkEvents.push(e.data.event);});
          frame.onload=()=>frame.contentWindow!.postMessage({channel:'yaplix_init',protocolVersion:1,...session},'*');
          frame.srcdoc='<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="'+csp+'"><script>'+compat+'</script>'+html;
        },{html,session,csp:GAME_CSP,compat:UUID_COMPAT});
        phases.finish();phases.start('bridge-handshake');let bridgeObserved=false;
        try{await page.waitForFunction(marker=>(window as any).checkEvents.length>0||Boolean((window as any)[marker]),BROWSER_STORAGE_MARKER,{timeout:VALIDATION_BUDGETS.bridgeMs});bridgeObserved=true;}
        catch(error){if(signal.aborted)throw new Fault('BROWSER_TIMEOUT',504);if((error as Error).name!=='TimeoutError')throw error;}
        const storageAttempt=await page.evaluate(marker=>(window as any)[marker]??null,BROWSER_STORAGE_MARKER);
        if(typeof storageAttempt==='string')throw new BrowserFailure('BROWSER_STORAGE_ACCESS_FORBIDDEN',browserStorageFeedback(storageAttempt));
        if(errors.length)throw new BrowserFailure(errors[0],exception?'JavaScript error in generated code: '+exception:'A forbidden browser operation or console error occurred.');
        if(!bridgeObserved){
          phases.finish('SKIPPED','YAPLIX_BRIDGE_NOT_OBSERVED','NO_GAME_READY_EVENT');
          trace('browser.validator_routed',{status:'PASS',errorCode:'YAPLIX_BRIDGE_NOT_OBSERVED',details:{phase:'full-html',reasonCode:'NO_GAME_READY_EVENT'}});
          await context.close().catch(()=>{});phase='full_html';return await checkFullHtml(browser,html,deadline,trace,options.saveSnapshot);
        }
        phases.finish();phases.start('render');
        const frame=page.frames().find(f=>f!==page.mainFrame())!;
        await page.waitForTimeout(VALIDATION_BUDGETS.criticalMs);
        const start=frame.locator('[data-yaplix-start]');
        if(await start.count()!==1)throw new BrowserFailure('BROWSER_START_CONTROL','Mark exactly one initial Start button data-yaplix-start. Do not give this attribute to Restart. Ensure the initial Start is visible and no overlay intercepts it.');
        const box=await start.boundingBox();if(!box||box.height<44||box.x<0||box.x+box.width>width+2)throw new BrowserFailure('BROWSER_MOBILE_LAYOUT','At viewport '+width+'px the Start button is missing, outside the viewport, or under 44px tall. Give ALL buttons min-height:44px and constrain the layout to 100% viewport width.');
        const input=frame.locator('[data-yaplix-input]').first();
        const area=await input.boundingBox();if(!area||area.width<20||area.height<20||area.x<0||area.x+area.width>width+2)throw new BrowserFailure('BROWSER_GAME_AREA','The data-yaplix-input element needs visible nonzero dimensions within the '+width+'px viewport. Size canvas and its ancestors explicitly.');
        const canvases=await frame.locator('canvas').evaluateAll(nodes=>nodes.map(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height,backingWidth:(node as HTMLCanvasElement).width,backingHeight:(node as HTMLCanvasElement).height})));
        if(canvases.some(c=>c.width<20||c.height<20||c.backingWidth<1||c.backingHeight<1))throw new BrowserFailure('BROWSER_GAME_AREA','A canvas has zero or tiny dimensions. Give the visible game canvas and its container explicit responsive width and height, plus a nonzero backing size.');
        if(await frame.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2))throw new Fault('BROWSER_HORIZONTAL_OVERFLOW',502);
        const before=await page.evaluate(()=>(window as any).checkEvents);
        if(before.some((e:{type:string})=>e.type==='game_started'))throw new Fault('BROWSER_AUTOSTART',502);
        phase='interaction';phases.start('interaction');const interactionTimer=setTimeout(()=>{phaseBudgetExceeded=true;void context.close().catch(()=>{});},VALIDATION_BUDGETS.interactionMs);
        try{
        await start.tap();await page.waitForFunction(()=>(window as any).checkEvents.some((e:{type:string})=>e.type==='game_started'));
        const terminal=()=>page.evaluate(()=>(window as any).checkEvents.some((e:{type:string})=>e.type==='session_ended'));
        if(await terminal())throw new Fault('BROWSER_INSTANT_END',502);
        const capture=()=>frame.evaluate(()=>{const canvas=document.querySelector('canvas');return canvas?canvas.toDataURL():document.body.innerText;});
        // dataURL equality is strict: decorative backdrops keep shifting a tiny
        // fraction of the canvas in a correctly paused game. Real movement of
        // bodies changes far more pixel area, so pause evidence compares the
        // changed-pixel share instead of raw image bytes.
        const frameFreeze=()=>frame.evaluate(()=>{
          const c=document.querySelector('canvas');
          if(!(c instanceof HTMLCanvasElement))return null;
          const ctx=c.getContext('2d');if(!ctx)return null;
          const cur=ctx.getImageData(0,0,c.width,c.height).data;
          const w=window as any;const prev=w.__yaplixFreeze as number[]|undefined;
          w.__yaplixFreeze=Array.from(cur);
          if(!prev||prev.length!==cur.length)return -1;
          let changed=0;
          for(let p=0;p<cur.length;p+=4)if(Math.abs(cur[p]-prev[p])>12||Math.abs(cur[p+1]-prev[p+1])>12||Math.abs(cur[p+2]-prev[p+2])>12)changed++;
          return changed/(cur.length/4);
        });
        const preInput=await capture();
        const hud=()=>frame.evaluate(()=>document.querySelector('[data-yaplix-state]')?.textContent??null);
        const hudStates=new Set<string>();const observe=async()=>{const value=await hud();if(value)hudStates.add(value);};await observe();
        if(await input.isDisabled())throw new BrowserFailure('BROWSER_INPUT_DISABLED','Start left the marked gameplay control disabled.');
        await input.tap();await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowRight');await page.waitForTimeout(180);
        await observe();
        const inputEffective=await capture()!==preInput;
        if(canvases.length&&await frame.locator('canvas').count()===0)throw new BrowserFailure('BROWSER_GAME_AREA','A real input action removed the game canvas.');
        const surviving=await input.boundingBox();
        if(!surviving||surviving.width<20||surviving.height<20)throw new BrowserFailure('BROWSER_GAME_AREA','A real input action destroyed or hid the game area.');
        if(!await terminal()){
          const pause=frame.locator('[data-yaplix-pause]');if(await pause.count()!==1)throw new Fault('BROWSER_PAUSE_CONTROL',502);
          await pause.tap();
          // The paused overlay is painted on a later animation frame that can lag
          // badly under load, and decorative backdrops keep repainting a tiny
          // fraction of a correctly paused canvas. Pause evidence therefore uses
          // the changed-pixel share: decor stays far below real body movement.
          let frozenShare=-1,frozenText='',strictCompare=false;
          if(await frame.evaluate(()=>!!document.querySelector('canvas'))){
            for(let settle=0;settle<8;settle++){
              await page.waitForTimeout(200);
              const share=await frameFreeze();
              if(share===null){strictCompare=true;break;}
              if(share===-1)continue;
              if(share<0.005){frozenShare=share;break;}
            }
            if(strictCompare)frozenText=await capture();
            else if(frozenShare===-1)throw new Fault('BROWSER_PAUSE_NOT_FROZEN',502);
          }else strictCompare=true;
          if(strictCompare){frozenText=frozenText||await capture();await page.waitForTimeout(250);if(await capture()!==frozenText)throw new Fault('BROWSER_PAUSE_NOT_FROZEN',502);}
          else{const share=await frameFreeze();if(share!==null&&share>=0.005)throw new Fault('BROWSER_PAUSE_NOT_FROZEN',502);}
          const stateText=()=>frame.evaluate(()=>document.querySelector('output[data-yaplix-state]')?.textContent??'');
          const frozenState=await stateText();
          const resume=frame.getByRole('button',{name:/^(resume|continue|продолжить|возобновить)$/i}).filter({visible:true});
          const markedResume=frame.locator('[data-yaplix-resume]').filter({visible:true});
          if(await markedResume.count()===1)await markedResume.tap();else if(await resume.count()===1)await resume.tap();else await pause.tap();
          let resumed=false;
          const changed=async()=>{
            if(strictCompare)return await capture()!==frozenText||(frozenState&&await stateText()!==(frozenState||''))||await terminal();
            const share=await frameFreeze();
            return share!==null&&share>=0.005||(frozenState&&await stateText()!==(frozenState||''))||await terminal();
          };
          for(const key of ['ArrowRight','ArrowUp','ArrowLeft','ArrowDown',' ']){await page.keyboard.press(key);await page.waitForTimeout(40);if(await changed()){resumed=true;break;}}
          if(!resumed&&!await input.isDisabled()){await input.tap();await page.waitForTimeout(100);resumed=await changed();}
          // Keyboard-only evidence would wrongly fail touch-first games: tap the
          // visible in-game action buttons too (start, restart, pause and resume
          // stay excluded because restart must remain silent after session_ended).
          if(!resumed){
            const actions=frame.locator('button:visible:not([data-yaplix-start]):not([data-yaplix-pause]):not([data-yaplix-resume]):not([data-yaplix-restart])').filter({visible:true});
            const count=Math.min(4,await actions.count());
            for(let i=0;i<count&&!resumed;i++){await actions.nth(i).tap();await page.waitForTimeout(80);if(await changed())resumed=true;}
          }
          if(!resumed&&inputEffective)throw new BrowserFailure('BROWSER_RESUME_NOT_WORKING','After pause the game remained frozen despite resuming and real input. Make the marked pause control toggle, or provide a visible button marked data-yaplix-resume. Resume must retain the world/score and restart exactly one animation loop; input must visibly act again on resume.');
        }
        await observe();
        const events=await page.evaluate(()=>(window as any).checkEvents);let started=false,ended=false,result=false;
        for(let i=0;i<events.length;i++){
          let event;try{event=parseEvent(events[i]);}catch{throw new Fault('BROWSER_EVENT_CONTRACT',502);}
          if(event.sessionId!==session.sessionId||event.versionId!==session.versionId||event.sequence!==i||ended||i===0&&event.type!=='game_ready')throw new Fault('BROWSER_EVENT_ORDER',502);
          if(event.type==='game_started'){if(started)throw new Fault('BROWSER_DUPLICATE_START',502);started=true;}
          if(['score_changed','game_won','game_lost','session_ended'].includes(event.type)&&!started)throw new BrowserFailure('BROWSER_EVENT_ORDER','Received '+event.type+' before game_started. Initial setup/reset must not emit score or terminal events. In the first Start handler report game_started BEFORE initializing any state that emits events. Keep restart after session_ended silent.');
          if(event.type==='game_won'||event.type==='game_lost'){if(result)throw new Fault('BROWSER_DUPLICATE_END',502);result=true;}
          if(event.type==='session_ended'){if(!result)throw new Fault('BROWSER_EVENT_ORDER',502);ended=true;}
          if(event.type==='game_error')throw new Fault('BROWSER_GAME_ERROR',502);
        }
        if(errors.length)throw new BrowserFailure(errors[0],exception?'JavaScript error in the generated document: '+exception:'The game attempted a forbidden browser operation or logged an error.');
        {
          const scoreEvents=events.filter((e:{type:string})=>e.type==='score_changed').length;
          const report=summarizeSession({startWorks:true,inputChanged:inputEffective&&(hudStates.size>1||scoreEvents>0),hudStates:hudStates.size,scoreEvents,ended,won:false,lost:false,finalScore:null,errors:[],restartWorks:null,eventTypes:events.map((e:{type:string})=>e.type)},null);
          profileChecks=report.aspects.map(({aspect,level})=>({aspect,level}));
          // A terminal event alone cannot establish that the declared rule held.
          for(const check of profileChecks)if(['win-reachable','loss-reachable'].includes(check.aspect))check.level='NOT_VERIFIED';
        }
        }finally{clearTimeout(interactionTimer);}
        phases.finish();phase='restart';phases.start('restart');
        await page.goto('about:blank');
        await page.setContent('<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="'+GAME_CSP+'"><script>'+UUID_COMPAT+'</script>'+html);
        const standaloneState=()=>page.evaluate(()=>document.querySelector('[data-yaplix-state]')?.textContent??null);
        await page.locator('[data-yaplix-start]').tap();const initialState=await standaloneState();await page.locator('[data-yaplix-input]').first().tap();await page.waitForTimeout(100);
        const restart=page.locator('[data-yaplix-restart]').filter({visible:true});
        if(await restart.count()===1){
          const restartTimer=setTimeout(()=>{phaseBudgetExceeded=true;void context.close().catch(()=>{});},VALIDATION_BUDGETS.restartMs);
          try{
            const state=standaloneState;
            const prior=await state();await restart.tap();await page.waitForTimeout(100);
            const area=page.locator('[data-yaplix-input]').first();
            if(!await area.isVisible())throw new BrowserFailure('BROWSER_RESTART_FAILED','Restart removed or hid the game input.');
            const again=page.locator('[data-yaplix-start]');if(await again.isVisible()&&!await again.isDisabled())await again.tap();
            if(await area.isDisabled())throw new BrowserFailure('BROWSER_RESTART_FAILED','Restart left the game input disabled.');
            const reset=await state();await area.tap();await page.keyboard.press('ArrowRight');await page.waitForTimeout(100);const after=await state();
            let progressed=false;
            try{const initial=JSON.parse(initialState??'null'),p=JSON.parse(prior??'null'),r=JSON.parse(reset??'null'),a=JSON.parse(after??'null');if(initial&&p&&r&&a&&typeof initial.score==='number'&&typeof p.score==='number'&&p.score!==initial.score&&typeof r.score==='number'){
              if(r.score!==initial.score)throw new BrowserFailure('BROWSER_RESTART_FAILED','Restart did not restore the observed initial score.');
              progressed=JSON.stringify(initial)===JSON.stringify(r)&&JSON.stringify(a)!==JSON.stringify(r)&&a.score!==r.score;
            }}catch(error){if(error instanceof BrowserFailure)throw error;}
            if(progressed)profileChecks!.find(c=>c.aspect==='restart-works')!.level='VERIFIED';
          }finally{clearTimeout(restartTimer);}
        }
        if(errors.length)throw new BrowserFailure(errors[0],exception?'JavaScript error in the standalone document: '+exception:'The offline document attempted a forbidden operation or logged an error.');
        if(!checks)checks=profileChecks;else for(const check of checks)if(profileChecks!.find(c=>c.aspect===check.aspect)!.level!==check.level)check.level='NOT_VERIFIED';
        phases.finish('PASS');trace('browser.viewport.completed',{status:'PASS',durationMs:Math.round(performance.now()-began),profileWidth:width,profileHeight:height,details:{viewport:`${width}x${height}`,deviceScaleFactor:2,jsErrorCount:errors.length}});
      }catch(error){const errorCode=error instanceof Fault?error.code:phaseBudgetExceeded||(error as Error).name==='TimeoutError'?'BROWSER_TIMEOUT_'+phase.toUpperCase():'BROWSER_CHECK_INCONCLUSIVE',status=error instanceof Fault&&/TIMEOUT|INCONCLUSIVE/.test(error.code)||!(error instanceof Fault)&&/TIMEOUT|INCONCLUSIVE/.test(errorCode)?'NOT_VERIFIED':'FAIL';phases.finish(status as any,errorCode);trace('browser.viewport.completed',{status,durationMs:Math.round(performance.now()-began),profileWidth:width,profileHeight:height,errorCode,validationPhase:phase,details:{viewport:`${width}x${height}`,deviceScaleFactor:2,phase,jsErrorCount:errors.length}});if(errors.length)throw new BrowserFailure(errors[0],exception?'JavaScript error in generated code: '+exception:'A forbidden browser operation or console error occurred.');if(!(error instanceof Fault))throw new BrowserFailure(errorCode,error instanceof Error&&error.name==='TimeoutError'?'NOT_VERIFIED: '+phase+' timed out.':'NOT_VERIFIED: '+phase+' could not be completed.');throw error;}
      finally{await context.close().catch(()=>{});}
    }
    // Lifecycle markers must never bypass the rendering contract for a new
    // candidate. Historical preview/export do not invoke this generation gate.
    phase='full_html';const rendering=(await checkFullHtml(browser,html,deadline,trace,options.saveSnapshot)).rendering;
    return {profiles:[...BROWSER_PROFILES['startup-input-pause']],offline:true,errors:0,scope:'startup-input-pause',rendering,levels:['HTML_VALID','JS_EXECUTABLE','UI_VISIBLE','MOBILE_VERIFIED'],checks,elapsedMs:Math.round(performance.now()-began)};
  }catch(error){if(deadline.aborted){const details=error&&typeof error==='object'?error as {validationPhase?:unknown;profileWidth?:unknown;profileHeight?:unknown;feedback?:unknown}:{};throw Object.assign(new Fault(signal.aborted?'REQUEST_CANCELLED':'BROWSER_TIMEOUT_'+phase.toUpperCase(),signal.aborted?499:504),{...(typeof details.validationPhase==='string'?{validationPhase:details.validationPhase}:{}),...(typeof details.profileWidth==='number'?{profileWidth:details.profileWidth}:{}),...(typeof details.profileHeight==='number'?{profileHeight:details.profileHeight}:{}),...(typeof details.feedback==='string'?{feedback:details.feedback}:{})});}if(error instanceof Fault)throw error;throw new Fault('BROWSER_STARTUP_FAILED',502);}
  finally{deadline.removeEventListener('abort',abort);await browser.close();}
}
