import type { Browser, Frame } from 'playwright-core';
import { Fault } from './contracts.ts';
import { GAME_CSP, UUID_COMPAT } from './runtime.ts';
import type { BrowserEvidence } from './browser-check.ts';
import {BROWSER_VIEWPORTS,BROWSER_PROFILES} from './browser-profiles.ts';
import {randomUUID} from 'node:crypto';
import {observeCanvas,canvasSnapshot,finalCanvasSnapshot,requireCanvas} from './canvas-check.ts';

/** Bounded technical checks for arbitrary standalone games, without game-specific
 * selectors, telemetry, state injection or JavaScript rewriting. */
export async function checkFullHtml(browser:Browser,html:string,signal:AbortSignal):Promise<BrowserEvidence> {
  const began=performance.now();
  const renderContexts=new Set<'2d'|'webgl'|'webgl2'>();
  // Profiles are independent; run them together so a slow hosted runner does
  // not spend the same bounded validation deadline three times in sequence.
  const profiles=await Promise.allSettled(BROWSER_VIEWPORTS['full-html'].map(async({width,height})=>{
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2,hasTouch:true,isMobile:true,offline:true,serviceWorkers:'block',acceptDownloads:false});
    let failure='',phase='load';
    try{
      const canvasKey='__canvas_'+randomUUID().replaceAll('-','');
      await context.addInitScript(observeCanvas,{key:canvasKey,html});
      const page=await context.newPage();page.setDefaultTimeout(1500);
      page.on('pageerror',()=>{failure='JAVASCRIPT_EXCEPTION';});
      page.on('console',m=>{if(m.type()==='error')failure||='BROWSER_CONSOLE_ERROR';});
      page.on('dialog',d=>{failure||='NATIVE_DIALOG';void d.dismiss();});
      context.on('page',p=>{if(p!==page){failure||='POPUP';void p.close();}});
      const content='<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="'+GAME_CSP+'"><script>'+UUID_COMPAT+'</script>'+html;
      // Chromium can initialize srcdoc instrumentation after inline game code.
      // A locally fulfilled document guarantees pre-script observation. This
      // URL never reaches a network; only these two document loads are allowed.
      const validationUrl='https://yaplix-check.invalid/'+canvasKey;let loads=0;
      await context.route('**/*',r=>{
        if(r.request().url()===validationUrl&&r.request().isNavigationRequest()&&++loads<=2)return r.fulfill({status:200,contentType:'text/html; charset=utf-8',body:content});
        failure||='NETWORK_ATTEMPT';return r.abort();
      });
      await page.setContent('<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>');
      await page.locator('iframe').evaluate((node,url)=>{(node as HTMLIFrameElement).src=url;},validationUrl);
      const frame=await (await page.locator('iframe').elementHandle())!.contentFrame();
      if(!frame)throw new Fault('BROWSER_CHECK_INCONCLUSIVE',502);
      await frame.waitForURL(validationUrl,{waitUntil:'load'});await page.waitForTimeout(100);
      const probe=async(target:Frame,keyboard=false)=>{
        const samples=[await canvasSnapshot(target,canvasKey)];
        const check=async(initial=false)=>{
          if(failure)throw new Fault(failure,502);
          const sample=await finalCanvasSnapshot(target,canvasKey);samples.push(sample);
          // Refuse new UI immediately, before any later action can conceal it.
          // A Canvas menu may precede the world's first draw. Inspect DOM at
          // startup, then require current rendering after every real input.
          if(!initial||sample.dom||sample.canvases.some(c=>!c.fits))requireCanvas(samples,false);
        };
        await check(true);
        // Inspect UI revealed by real scrolling, without assigning scrollTop or
        // scrolling hidden content into view. This is a DOM-contract probe,
        // not evidence that arbitrary phone/game controls are reachable.
        phase='scroll-ui';
        const scrolls=await target.evaluate(()=>[...document.querySelectorAll('*')].filter(el=>{
          const s=getComputedStyle(el),r=el.getBoundingClientRect();
          if(s.visibility!=='visible'||Number(s.opacity)===0||r.width<20||r.height<20||r.right<=0||r.bottom<=0||r.left>=innerWidth||r.top>=innerHeight)return false;
          return /auto|scroll/.test(s.overflowY)&&el.scrollHeight>el.clientHeight+2||/auto|scroll/.test(s.overflowX)&&el.scrollWidth>el.clientWidth+2;
        }).slice(0,3).map(el=>{
          const r=el.getBoundingClientRect();return{x:(Math.max(0,r.left)+Math.min(innerWidth,r.right))/2,y:(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2,dx:el.scrollWidth>el.clientWidth+2?el.scrollWidth:0,dy:el.scrollHeight>el.clientHeight+2?el.scrollHeight:0};
        }));
        for(const {x,y,dx,dy} of scrolls){
          if(signal.aborted)throw new Fault('BROWSER_TIMEOUT',504);
          await page.mouse.move(x,y);await page.mouse.wheel(dx,dy);await page.waitForTimeout(50);
          if(failure)throw new Fault(failure,502);
          const sample=await canvasSnapshot(target,canvasKey);if(sample.dom)requireCanvas([sample],false);
        }
        phase='canvas-input';
        // Bounded generic search, never fixture labels or internal game state.
        // Repeated centre probes may reach Start, play, terminal and Restart;
        // their actual semantics remain NOT_VERIFIED for arbitrary games.
        const points=[[.5,.5],[.5,.5],[.25,.65],[.75,.65],[.5,.5],[.5,.5],[.25,.5],[.75,.5]];
        const frameBox=target.parentFrame()?await (await target.frameElement()).boundingBox():null;
        if(target.parentFrame()&&!frameBox)throw new Fault('BROWSER_CHECK_INCONCLUSIVE',502);
        for(const [x,y] of points){
          if(signal.aborted)throw new Fault('BROWSER_TIMEOUT',504);
          // Select the same first active canvas in one browser round trip.
          // A real touchscreen tap keeps the input evidence and avoids
          // Playwright's repeated locator actionability polling per tap.
          const point=await target.locator('canvas').evaluateAll((nodes,[x,y])=>{
            for(const el of nodes.slice(0,32)){
              if(el.matches(':disabled')||el.closest('[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"]'))continue;
              let active=true;
              for(let p:Element|null=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)===0||s.pointerEvents==='none'){active=false;break;}}
              if(!active)continue;
              const r=el.getBoundingClientRect();
              // Never scroll an unobserved state into view.
              if(!(r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight))continue;
              const cx=(Math.max(0,r.left)+Math.min(innerWidth,r.right))/2;
              const cy=(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2;
              const hit=document.elementFromPoint(cx,cy);
              if(!hit||!el.contains(hit))continue;
              // Backing coordinates map to the same CSS-relative tap point.
              const c=el as HTMLCanvasElement;
              return {x:r.left+(c.width*x)*r.width/c.width,y:r.top+(c.height*y)*r.height/c.height};
            }
            return null;
          },[x,y]);
          if(!point)break;
          await page.touchscreen.tap(point.x+(frameBox?.x??0),point.y+(frameBox?.y??0));
          await page.waitForTimeout(50);await check();
        }
        if(keyboard){await page.keyboard.press('ArrowRight');await page.waitForTimeout(50);await check();}
        await page.waitForTimeout(100);await check();
        // Exclude the initial screen: a Start-only redraw cannot establish
        // subsequent technical interaction. Unknown hitboxes remain unverified.
        for(const kind of requireCanvas(samples.slice(2)))renderContexts.add(kind);
      };
      phase='layout';const visible=await frame.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+2}));
      if(visible.overflow)throw new Fault('BROWSER_HORIZONTAL_OVERFLOW',502);
      await probe(frame);
      phase='standalone';await page.goto(validationUrl,{waitUntil:'load'});await page.waitForTimeout(100);
      await probe(page.mainFrame(),true);
      if(signal.aborted)throw new Fault('BROWSER_TIMEOUT',504);
    }catch(error){
      if(failure)throw Object.assign(new Fault(failure,502),{validationPhase:phase,profileWidth:width,profileHeight:height});
      if(error instanceof Fault)throw Object.assign(error,{validationPhase:phase,profileWidth:width,profileHeight:height});
      throw Object.assign(new Fault(signal.aborted?'BROWSER_TIMEOUT':'BROWSER_CHECK_INCONCLUSIVE',502),{validationPhase:phase,profileWidth:width,profileHeight:height});
    }finally{await context.close().catch(()=>{});}
  }));
  const failed=profiles.find(result=>result.status==='rejected');
  if(failed?.status==='rejected')throw failed.reason;
  return {profiles:[...BROWSER_PROFILES['full-html']],offline:true,errors:0,scope:'full-html',rendering:{contract:'canvas-webgl-strict-v2',contexts:[...renderContexts],profiles:[...BROWSER_PROFILES['full-html']]},levels:['HTML_VALID','JS_EXECUTABLE','UI_VISIBLE','MOBILE_VERIFIED'],elapsedMs:Math.round(performance.now()-began),checks:([
    'html-runs','input-works','gameplay-observed','win-reachable','loss-reachable','restart-works'
  ] as const).map(aspect=>({aspect,level:aspect==='html-runs'?'VERIFIED':'NOT_VERIFIED'}))};
}
