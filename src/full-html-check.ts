import type { Browser, Frame, Page } from 'playwright-core';
import { Fault } from './contracts.ts';
import { GAME_CSP, UUID_COMPAT } from './runtime.ts';
import type { BrowserEvidence } from './browser-check.ts';
import {BROWSER_VIEWPORTS,BROWSER_PROFILES} from './browser-profiles.ts';
import {randomUUID} from 'node:crypto';
import {observeCanvas,canvasSnapshot,finalCanvasSnapshot,requireCanvas,canvasDiagnosticFeedback,canvasTextLayoutEvidence,requireCanvasTextLayout} from './canvas-check.ts';
import type {CanvasProbe,CanvasSnapshot} from './canvas-check.ts';
import {BROWSER_STORAGE_INIT_SCRIPT,BROWSER_STORAGE_MARKER,browserStorageFeedback,browserStorageName} from './browser-storage-guard.ts';
import {browserPhaseTracker} from './browser-phase.ts';
import type { TraceData } from './generation-trace.ts';

export function webglContextFailure(context:string,error:string){
  if((context==='webgl'||context==='webgl2')&&/createProgram|shaderSource|drawArrays/i.test(error))return{code:'BROWSER_WEBGL_CONTEXT_UNAVAILABLE',feedback:`${context} context creation returned null in the protected browser; no software fallback was used.`};
  return undefined;
}

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
export async function checkFullHtml(browser:Browser,html:string,signal:AbortSignal,trace?:(event:string,data?:TraceData)=>void,saveSnapshot?:(viewport:string,image:Uint8Array)=>{captureId:string;sha256:string}|void):Promise<BrowserEvidence> {
  const began=performance.now();
  const renderContexts=new Set<'2d'|'webgl'|'webgl2'>();
  for(const {width,height} of BROWSER_VIEWPORTS['full-html']){
    const phases=browserPhaseTracker((event,data)=>trace?.(event,data),`${width}x${height}`);
    try{trace?.('browser.viewport.started',{details:{viewport:`${width}x${height}`,deviceScaleFactor:2}});}catch{}
    phases.start('document-load');
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2,hasTouch:true,isMobile:true,offline:true,serviceWorkers:'block',acceptDownloads:false});
    let failure='',failureFeedback='',phase='load',page:Page|undefined,webglDiagnostic:Promise<void>|undefined;const samples:CanvasSnapshot[]=[],probes:CanvasProbe[]=[],jsErrors:string[]=[];
    const diagnosticDetails=()=>{const before=samples[0]?.canvases[0],last=samples.at(-1),after=before&&last?.canvases.find(c=>c.id===before.id),point=probes.at(-1)?.cssPoint;return{viewport:`${width}x${height}`,deviceScaleFactor:2,phase,jsErrorCount:jsErrors.length,drawCalls:samples.reduce((n,s)=>n+s.canvases.reduce((m,c)=>m+c.draws,0),0),frameHashBefore:before?.image??'',frameHashAfter:after?.image??'',frameChanged:Boolean(before&&after&&before.image!==after.image),canvasContexts:[...new Set(samples.flatMap(s=>s.canvases.map(c=>c.context)))].slice(0,8),canvasSampling:(last?.canvases??[]).slice(0,4).map(c=>({id:c.id,context:c.context,...c.sampling})),canvasTextLayout:last?canvasTextLayoutEvidence(last,{width,height},phase):{status:'NOT_VERIFIED',confirmed:false,coverage:'NOT_VERIFIED',viewport:{width,height},dpr:2,phase,canvases:[],texts:[],semanticHitboxes:'NOT_VERIFIED'},...(probes.length?{inputAction:'generic_canvas_tap',inputX:point?.[0]??0,inputY:point?.[1]??0,inputObserved:probes.some(p=>p.hashChanged||Number(p.drawDelta)>0)}:{})};};
    try{
      const canvasKey='__canvas_'+randomUUID().replaceAll('-','');
      await context.addInitScript(BROWSER_STORAGE_INIT_SCRIPT);
      await context.addInitScript(observeCanvas,{key:canvasKey,html});
      const activePage=await context.newPage();page=activePage;activePage.setDefaultTimeout(1500);
      activePage.on('pageerror',error=>{jsErrors.push(error.message.slice(0,240));const storage=browserStorageName(error.message);failure=storage?'BROWSER_STORAGE_ACCESS_FORBIDDEN':'JAVASCRIPT_EXCEPTION';failureFeedback=storage?browserStorageFeedback(storage):'JavaScript error in generated document: '+error.message.slice(0,400);if(!storage)webglDiagnostic=activePage.evaluate(()=>({context:String((window as any).__yaplixWebglUnavailable??''),error:String((window as any).__yaplixLastGameError??'')})).then(result=>{const diagnostic=webglContextFailure(result.context,error.message);if(diagnostic){failure=diagnostic.code;failureFeedback=diagnostic.feedback;}}).catch(()=>{});});
      activePage.on('console',m=>{if(m.type()==='error')failure||='BROWSER_CONSOLE_ERROR';});
      activePage.on('dialog',d=>{failure||='NATIVE_DIALOG';void d.dismiss();});
      context.on('page',p=>{if(p!==activePage){failure||='POPUP';void p.close();}});
      const content='<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="'+GAME_CSP+'"><script>'+UUID_COMPAT+'</script>'+html;
      // Chromium can initialize srcdoc instrumentation after inline game code.
      // A locally fulfilled document guarantees pre-script observation. This
      // URL never reaches a network; only these two document loads are allowed.
      const validationUrl='https://yaplix-check.invalid/'+canvasKey;let loads=0;
      await context.route('**/*',r=>{
        if(r.request().url()===validationUrl&&r.request().isNavigationRequest()&&++loads<=2)return r.fulfill({status:200,contentType:'text/html; charset=utf-8',body:content});
        failure||='NETWORK_ATTEMPT';return r.abort();
      });
      await activePage.setContent('<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>');
      await activePage.locator('iframe').evaluate((node,url)=>{(node as HTMLIFrameElement).src=url;},validationUrl);
      const frame=await (await activePage.locator('iframe').elementHandle())!.contentFrame();
      if(!frame)throw new Fault('BROWSER_CHECK_INCONCLUSIVE',502);
      await frame.waitForURL(validationUrl,{waitUntil:'load'});await activePage.waitForTimeout(100);
      phases.finish();
      phases.start('layout');
      const probe=async(target:Frame,keyboard=false)=>{
        samples.push(await canvasSnapshot(target,canvasKey));
        const check=async(initial=false)=>{
          if(webglDiagnostic)await webglDiagnostic;
          const storage=await activePage.evaluate(marker=>(window as any)[marker]??null,BROWSER_STORAGE_MARKER);
          if(typeof storage==='string')throw Object.assign(new Fault('BROWSER_STORAGE_ACCESS_FORBIDDEN',502),{feedback:browserStorageFeedback(storage)});
          if(failure)throw new Fault(failure,502);
          const sample=await finalCanvasSnapshot(target,canvasKey);samples.push(sample);
          // Refuse new UI immediately, before any later action can conceal it.
          // A Canvas menu may precede the world's first draw. Inspect DOM at
          // startup, then require current rendering after every real input.
          if(!initial||sample.dom||sample.canvases.some(c=>!c.fits))requireCanvas(samples,false);
          requireCanvasTextLayout(samples,{width,height},phase);
        };
        await check(true);
        // Inspect UI revealed by real scrolling, without assigning scrollTop or
        // scrolling hidden content into view. This is a DOM-contract probe,
        // not evidence that arbitrary phone/game controls are reachable.
        phase='scroll-ui';phases.start('scroll-ui');
        const scrolls=await target.evaluate(()=>[...document.querySelectorAll('*')].filter(el=>{
          const s=getComputedStyle(el),r=el.getBoundingClientRect();
          if(s.visibility!=='visible'||Number(s.opacity)===0||r.width<20||r.height<20||r.right<=0||r.bottom<=0||r.left>=innerWidth||r.top>=innerHeight)return false;
          return /auto|scroll/.test(s.overflowY)&&el.scrollHeight>el.clientHeight+2||/auto|scroll/.test(s.overflowX)&&el.scrollWidth>el.clientWidth+2;
        }).slice(0,3).map(el=>{
          const r=el.getBoundingClientRect();return{x:(Math.max(0,r.left)+Math.min(innerWidth,r.right))/2,y:(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2,dx:el.scrollWidth>el.clientWidth+2?el.scrollWidth:0,dy:el.scrollHeight>el.clientHeight+2?el.scrollHeight:0};
        }));
        for(const {x,y,dx,dy} of scrolls){
          if(signal.aborted)throw new Fault('BROWSER_TIMEOUT',504);
          await activePage.mouse.move(x,y);await activePage.mouse.wheel(dx,dy);await activePage.waitForTimeout(50);
          if(failure)throw new Fault(failure,502);
          const sample=await canvasSnapshot(target,canvasKey);if(sample.dom)requireCanvas([sample],false);
        }
        phase='canvas-input';phases.start('canvas-input');
        // Bounded generic search, never fixture labels or internal game state.
        // A small set of generic probes confirms responsive rendering without
        // spending the production deadline searching arbitrary hitboxes.
        // Their game semantics, terminal states and Restart remain NOT_VERIFIED.
        // Probe the board, the common centered Start region, and the lower
        // Start region. Cap the scan at three taps so generic input cannot
        // advance an unknown game all the way into a terminal state.
        const points=[[.5,.5],[.5,.58],[.5,.88]];
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
            const before=samples.at(-1),canvasId=before?.canvases[i]?.id??null;
            let tapCompleted=false;
            try{await canvas.tap({position:point});tapped=true;tapCompleted=true;await activePage.waitForTimeout(50);await check();}finally{
              const after=samples.at(-1),prior=before?.canvases.find(c=>c.id===canvasId),next=after?.canvases.find(c=>c.id===canvasId);
              probes.push({point:[x,y],cssPoint:[point.x,point.y],canvasId,hashChanged:!!prior&&!!next&&prior.image!==next.image,drawDelta:prior&&next?next.draws-prior.draws:null,before:prior,after:next,tapAttempted:true,tapCompleted,startActionEvidence:'unverified'});
            }
            break;
          }
          if(!tapped)break;
        }
        if(keyboard){await activePage.keyboard.press('ArrowRight');await activePage.waitForTimeout(50);await check();}
        await activePage.waitForTimeout(100);await check();
        // Generic input only confirms observable Canvas activity, not game
        // semantics; gameplay, terminal states, and Restart remain unverified.
        for(const kind of requireCanvas(samples.slice(2)))renderContexts.add(kind);
      };
      phase='layout';const visible=await frame.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+2}));
      if(visible.overflow)throw new Fault('BROWSER_HORIZONTAL_OVERFLOW',502);
      await probe(frame);
      phase='standalone';phases.start('standalone');await activePage.goto(validationUrl,{waitUntil:'load'});await activePage.waitForTimeout(100);
      await probe(page.mainFrame(),true);
      if(signal.aborted)throw new Fault('BROWSER_TIMEOUT',504);
      phases.finish('PASS');try{trace?.('browser.viewport.completed',{status:'PASS',durationMs:Math.round(performance.now()-began),profileWidth:width,profileHeight:height,details:diagnosticDetails()});}catch{}
    }catch(error){
      let snapshot:{captureId:string;sha256:string}|undefined;try{if(page&&saveSnapshot){const png=await page.screenshot({type:'png',timeout:1200,animations:'disabled'});snapshot=saveSnapshot(`${width}x${height}`,png)||undefined;}}catch{}
      const errorCode=error instanceof Fault?error.code:'BROWSER_CHECK_INCONCLUSIVE',notVerified=error instanceof Fault&&/TIMEOUT|INCONCLUSIVE|UNAVAILABLE/.test(error.code),status=notVerified?'NOT_VERIFIED':'FAIL';phases.finish(status as any,errorCode);
      try{trace?.('browser.viewport.completed',{status:notVerified?'NOT_VERIFIED':'FAIL',durationMs:Math.round(performance.now()-began),profileWidth:width,profileHeight:height,errorCode:error instanceof Fault?error.code:'BROWSER_CHECK_INCONCLUSIVE',validationPhase:phase,details:{...diagnosticDetails(),...(snapshot?{snapshotCaptureId:snapshot.captureId,snapshotSha256:snapshot.sha256}:{})}});}catch{}
      if(failure)throw Object.assign(new Fault(failure,502),{feedback:failureFeedback||failure,validationPhase:phase,profileWidth:width,profileHeight:height});
      if(error instanceof Fault){
        const feedback=/^BROWSER_CANVAS_(?:RENDER|ACTIVITY)_UNVERIFIED$/.test(error.code)||error.code==='BROWSER_CANVAS_TEXT_CLIPPED'||error.code==='BROWSER_CANVAS_UI_OVERLAP'||error.code==='BROWSER_TIMEOUT'?canvasDiagnosticFeedback(error.code,phase,samples,probes,{width,height},jsErrors,snapshot):undefined;
        throw Object.assign(error,{...(feedback?{feedback}:{}),validationPhase:phase,profileWidth:width,profileHeight:height});
      }
      const code=signal.aborted?'BROWSER_TIMEOUT':'BROWSER_CHECK_INCONCLUSIVE';
      const feedback=signal.aborted?canvasDiagnosticFeedback(code,phase,samples,probes,{width,height},jsErrors):undefined;
      throw Object.assign(new Fault(code,502),{...(feedback?{feedback}:{}),validationPhase:phase,profileWidth:width,profileHeight:height});
    }finally{await context.close().catch(()=>{});}
  }
  return {profiles:[...BROWSER_PROFILES['full-html']],offline:true,errors:0,scope:'full-html',rendering:{contract:'canvas-webgl-strict-v2',contexts:[...renderContexts],profiles:[...BROWSER_PROFILES['full-html']]},levels:['HTML_VALID','JS_EXECUTABLE','UI_VISIBLE','MOBILE_VERIFIED'],elapsedMs:Math.round(performance.now()-began),checks:([
    'html-runs','input-works','gameplay-observed','win-reachable','loss-reachable','restart-works'
  ] as const).map(aspect=>({aspect,level:aspect==='html-runs'?'VERIFIED':'NOT_VERIFIED'}))};
}
