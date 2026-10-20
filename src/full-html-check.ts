import type { Browser, Frame } from 'playwright-core';
import { Fault } from './contracts.ts';
import { GAME_CSP, UUID_COMPAT } from './runtime.ts';
import type { BrowserEvidence } from './browser-check.ts';
import {BROWSER_VIEWPORTS,BROWSER_PROFILES} from './browser-profiles.ts';
import {randomUUID} from 'node:crypto';
import {observeCanvas,canvasSnapshot,finalCanvasSnapshot,requireCanvas} from './canvas-check.ts';

function activeElement(el:Element):boolean {
  if(el.matches(':disabled')||el.closest('[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"]'))return false;
  for(let p:Element|null=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)===0||s.pointerEvents==='none')return false;}
  const r=el.getBoundingClientRect();
  // Do not auto-scroll to controls belonging to an unobserved offscreen state.
  if(!(r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight))return false;
  // A visible canvas can still be covered by a start overlay. Probe a point
  // inside its visible intersection, retaining partially visible controls.
  const x=(Math.max(0,r.left)+Math.min(innerWidth,r.right))/2;
  const y=(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2;
  const hit=document.elementFromPoint(x,y);
  return !!hit&&el.contains(hit);
}

/** Bounded technical checks for arbitrary standalone games, without game-specific
 * selectors, telemetry, state injection or JavaScript rewriting. */
export async function checkFullHtml(browser:Browser,html:string,signal:AbortSignal):Promise<BrowserEvidence> {
  const began=performance.now();
  const renderContexts=new Set<'2d'|'webgl'|'webgl2'>();
  for(const {width,height} of BROWSER_VIEWPORTS['full-html']){
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2,hasTouch:true,isMobile:true,offline:true,serviceWorkers:'block',acceptDownloads:false});
    let failure='',phase='load';
    try{
      const canvasKey='__canvas_'+randomUUID().replaceAll('-','');
      await context.addInitScript(observeCanvas,canvasKey);
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
        for(const [x,y] of points){
          if(signal.aborted)throw new Fault('BROWSER_TIMEOUT',504);
          const surfaces=target.locator('canvas');let tapped=false;
          for(let i=0,n=Math.min(32,await surfaces.count());i<n;i++){
            const canvas=surfaces.nth(i);
            if(!await canvas.evaluate(activeElement))continue;
            const point=await canvas.evaluate((node,[x,y])=>{
              const c=node as HTMLCanvasElement,r=c.getBoundingClientRect();
              // Work through backing coordinates then return CSS coordinates.
              // This remains correct for DPR and independent CSS scaling.
              return {x:(c.width*x)*r.width/c.width,y:(c.height*y)*r.height/c.height};
            },[x,y]);
            await canvas.tap({position:point});tapped=true;break;
          }
          if(!tapped)break;
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
  }
  return {profiles:[...BROWSER_PROFILES['full-html']],offline:true,errors:0,scope:'full-html',rendering:{contract:'canvas-webgl-strict-v2',contexts:[...renderContexts],profiles:[...BROWSER_PROFILES['full-html']]},levels:['HTML_VALID','JS_EXECUTABLE','UI_VISIBLE','MOBILE_VERIFIED'],elapsedMs:Math.round(performance.now()-began),checks:([
    'html-runs','input-works','gameplay-observed','win-reachable','loss-reachable','restart-works'
  ] as const).map(aspect=>({aspect,level:aspect==='html-runs'?'VERIFIED':'NOT_VERIFIED'}))};
}
