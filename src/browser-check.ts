import { resolve } from 'node:path';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { parseEvent, Fault } from './contracts.ts';
import { GAME_CSP, UUID_COMPAT } from './runtime.ts';
import { PROJECT_ROOT } from './store.ts';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(PROJECT_ROOT,'.local/playwright');
// Playwright creates its temporary browser profiles in the parent process.
const temp=resolve(PROJECT_ROOT,'.local/tmp');mkdirSync(temp,{recursive:true});
for(const key of ['TEMP','TMP','TMPDIR'])process.env[key]=temp;
const {chromium}=await import('playwright-core');

export type BrowserEvidence = { profiles: number[]; offline: true; errors: 0; scope: 'startup-input-pause' };
export class BrowserFailure extends Fault {
  readonly feedback:string;
  constructor(code:string,feedback:string){super(code,502);this.feedback=feedback.slice(0,512);}
}
export function checkerReady() { return existsSync(chromium.executablePath()); }
export async function browserCheck(html: string, signal: AbortSignal): Promise<BrowserEvidence> {
  if (!checkerReady()) throw new Fault('BROWSER_INSTALL_REQUIRED',503);
  const deadline=AbortSignal.any([signal,AbortSignal.timeout(18000)]);
  const env=Object.fromEntries(['PATH','Path','SystemRoot','TEMP','TMP','TMPDIR','HOME','USERPROFILE','LOCALAPPDATA','DISPLAY','XDG_RUNTIME_DIR','LANG'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]!]));
  // Chromium's supported root-owned helper preserves its sandbox on Ubuntu's
  // restricted user namespaces. Never change AppArmor or use --no-sandbox.
  if(process.platform==='linux'){
    const helper=process.env.CHROME_DEVEL_SANDBOX??'/opt/google/chrome/chrome-sandbox';
    if(existsSync(helper)){
      const info=statSync(helper);
      if(!info.isFile()||info.uid!==0||(info.mode&0o4000)===0||(info.mode&0o022)!==0)throw new Fault('BROWSER_SANDBOX_CONFIGURATION',503);
      env.CHROME_DEVEL_SANDBOX=helper;
    }else if(process.env.CHROME_DEVEL_SANDBOX)throw new Fault('BROWSER_SANDBOX_CONFIGURATION',503);
  }
  const browser=await chromium.launch({headless:true,chromiumSandbox:true,timeout:8000,env}).catch(()=>{throw new Fault('BROWSER_SANDBOX_UNAVAILABLE',503);});
  const abort=()=>void browser.close().catch(()=>{});deadline.addEventListener('abort',abort,{once:true});
  try {
    for(const width of [320,390]) {
      if(deadline.aborted)throw new Fault('BROWSER_TIMEOUT',504);
      const context=await browser.newContext({viewport:{width,height:700},deviceScaleFactor:2,hasTouch:true,isMobile:true,offline:true,serviceWorkers:'block',acceptDownloads:false});
      const page=await context.newPage();page.setDefaultTimeout(3500);const errors:string[]=[];
      let exception='';page.on('pageerror',error=>{errors.push('JAVASCRIPT_EXCEPTION');exception=error.message.slice(0,250);});
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
        await page.waitForFunction(()=>(window as any).checkEvents.length>0);
        const frame=page.frames().find(f=>f!==page.mainFrame())!;
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
        await start.tap();await page.waitForFunction(()=>(window as any).checkEvents.some((e:{type:string})=>e.type==='game_started'));
        const terminal=()=>page.evaluate(()=>(window as any).checkEvents.some((e:{type:string})=>e.type==='session_ended'));
        if(await terminal())throw new Fault('BROWSER_INSTANT_END',502);
        await input.tap();await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowRight');await page.waitForTimeout(180);
        if(!await terminal()){
          const pause=frame.locator('[data-yaplix-pause]');if(await pause.count()!==1)throw new Fault('BROWSER_PAUSE_CONTROL',502);
          await pause.tap();
          const capture=()=>frame.evaluate(()=>{const canvas=document.querySelector('canvas');return canvas?canvas.toDataURL():document.body.innerText;});
          const frozen=await capture();await page.waitForTimeout(250);if(await capture()!==frozen)throw new Fault('BROWSER_PAUSE_NOT_FROZEN',502);
          await pause.tap();await page.waitForTimeout(100);
        }
        const events=await page.evaluate(()=>(window as any).checkEvents);let started=false,ended=false,result=false;
        for(let i=0;i<events.length;i++){
          let event;try{event=parseEvent(events[i]);}catch{throw new Fault('BROWSER_EVENT_CONTRACT',502);}
          if(event.sessionId!==session.sessionId||event.versionId!==session.versionId||event.sequence!==i||ended||i===0&&event.type!=='game_ready')throw new Fault('BROWSER_EVENT_ORDER',502);
          if(event.type==='game_started'){if(started)throw new Fault('BROWSER_DUPLICATE_START',502);started=true;}
          if(['score_changed','game_won','game_lost','session_ended'].includes(event.type)&&!started)throw new Fault('BROWSER_EVENT_ORDER',502);
          if(event.type==='game_won'||event.type==='game_lost'){if(result)throw new Fault('BROWSER_DUPLICATE_END',502);result=true;}
          if(event.type==='session_ended'){if(!result)throw new Fault('BROWSER_EVENT_ORDER',502);ended=true;}
          if(event.type==='game_error')throw new Fault('BROWSER_GAME_ERROR',502);
        }
        if(errors.length)throw new BrowserFailure(errors[0],exception?'JavaScript error in the generated document: '+exception:'The game attempted a forbidden browser operation or logged an error.');
        await page.goto('about:blank');
        await page.setContent('<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="'+GAME_CSP+'"><script>'+UUID_COMPAT+'</script>'+html);
        await page.locator('[data-yaplix-start]').tap();await page.locator('[data-yaplix-input]').first().tap();await page.waitForTimeout(100);
        if(errors.length)throw new BrowserFailure(errors[0],exception?'JavaScript error in the standalone document: '+exception:'The offline document attempted a forbidden operation or logged an error.');
      }catch(error){if(errors.length)throw new BrowserFailure(errors[0],exception?'JavaScript error in generated code: '+exception:'A forbidden browser operation or console error occurred.');throw error;}
      finally{await context.close().catch(()=>{});}
    }
    return {profiles:[320,390],offline:true,errors:0,scope:'startup-input-pause'};
  }catch(error){if(deadline.aborted)throw new Fault(signal.aborted?'REQUEST_CANCELLED':'BROWSER_TIMEOUT',signal.aborted?499:504);if(error instanceof Fault)throw error;throw new Fault('BROWSER_STARTUP_FAILED',502);}
  finally{deadline.removeEventListener('abort',abort);await browser.close();}
}
