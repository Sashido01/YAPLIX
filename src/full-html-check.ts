import type { Browser, Frame } from 'playwright-core';
import { Fault } from './contracts.ts';
import { GAME_CSP, UUID_COMPAT } from './runtime.ts';
import type { BrowserEvidence } from './browser-check.ts';

function activeElement(el:Element):boolean {
  if(el.matches(':disabled')||el.closest('[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"]'))return false;
  for(let p:Element|null=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)===0||s.pointerEvents==='none')return false;}
  const r=el.getBoundingClientRect();
  // Do not auto-scroll to controls belonging to an unobserved offscreen state.
  return r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight;
}

/** Fail only on a wholly offscreen, active control with no scroll route back.
 * Scrollability is deliberately overestimated: uncertain layouts must not fail.
 * No scrollIntoView(): it can scroll overflow:hidden, unlike a phone user. */
async function checkControlReachability(frame:Frame,known:Set<string>,landscape:boolean) {
  const snapshot=await frame.evaluate(()=>{
    const root=document.documentElement,body=document.body;
    const rootStyle=getComputedStyle(root),bodyStyle=getComputedStyle(body);
    const result:{index:number;native:boolean;key:string}[]=[],reachable:string[]=[];
    const elements=[...document.querySelectorAll<HTMLElement>('*')];
    for(let index=0;index<elements.length;index++){
      const el=elements[index],style=getComputedStyle(el),r=el.getBoundingClientRect();
      const native=el.matches('button,input[type=button],input[type=submit],[role=button]');
      if(!native&&style.cursor!=='pointer')continue;
      if(el.matches(':disabled')||el.closest('[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"]')||!r.width||!r.height)continue;
      let inactive=false;
      for(let p:HTMLElement|null=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)===0||s.pointerEvents==='none'){inactive=true;break;}}
      if(inactive)continue;
      const path:string[]=[];
      for(let p:Element|null=el;p;p=p.parentElement)path.push(p.tagName+':'+Array.prototype.indexOf.call(p.parentElement?.children??[],p));
      const key=el.id?'id:'+el.id:path.join('/');
      const x=r.left+r.width/2,y=r.top+r.height/2;
      const hit=x>=0&&x<innerWidth&&y>=0&&y<innerHeight?document.elementFromPoint(x,y):null;
      if(hit&&el.contains(hit))reachable.push(key);
      const blocked=([['Y',r.top,r.bottom,innerHeight],['X',r.left,r.right,innerWidth]] as const).some(([axis,near,far,size])=>{
        if(near<size&&far>0)return false; // Partial visibility is not proof of failure.
        const overflow=axis==='Y'?'overflowY':'overflowX';
        const extent=axis==='Y'?'scrollHeight':'scrollWidth',client=axis==='Y'?'clientHeight':'clientWidth';
        // Body overflow propagates to the viewport when the root is visible.
        const viewportOverflow=rootStyle[overflow]==='visible'?bodyStyle[overflow]:rootStyle[overflow];
        if(!/^(hidden|clip)$/.test(viewportOverflow)&&Math.max(root[extent],body[extent])>size+2)return false;
        for(let p=el.parentElement;p&&p!==root;p=p.parentElement){
          if(/^(auto|scroll|overlay)$/.test(getComputedStyle(p)[overflow])&&p[extent]>p[client]+2)return false;
        }
        return true;
      });
      if(blocked)result.push({index,native,key});
      if(result.length===64)break; // Bound CDP listener inspection for arbitrary HTML.
    }
    return {candidates:result,reachable};
  });
  if(!landscape){for(const key of snapshot.reachable)known.add(key);return;}
  // An offscreen future-state button is not a defect merely because it exists.
  // Require the same control to have been hit-testable in a portrait sample.
  const candidates=snapshot.candidates.filter(c=>known.has(c.key));
  if(!candidates.length)return;
  if(candidates.some(c=>c.native))throw new Fault('BROWSER_CONTROLS_UNREACHABLE',502);
  // Nonsemantic div controls need a real input listener, not just cursor styling.
  // Attach to the opaque frame itself; its listeners live in its default world.
  const session=await frame.page().context().newCDPSession(frame);
  try{
    for(const {index} of candidates){
      const {result}=await session.send('Runtime.evaluate',{expression:`document.querySelectorAll('*')[${index}]`,objectGroup:'yaplix-controls'});
      if(!result.objectId)continue;
      const {listeners}=await session.send('DOMDebugger.getEventListeners',{objectId:result.objectId});
      if(listeners.some(l=>/^(click|pointerdown|pointerup|touchstart|touchend|mousedown|mouseup)$/.test(l.type)))throw new Fault('BROWSER_CONTROLS_UNREACHABLE',502);
    }
  }finally{await session.send('Runtime.releaseObjectGroup',{objectGroup:'yaplix-controls'}).catch(()=>{});await session.detach().catch(()=>{});}
}

/** Bounded technical checks for arbitrary standalone games, without game-specific
 * selectors, telemetry, state injection or JavaScript rewriting. */
export async function checkFullHtml(browser:Browser,html:string,signal:AbortSignal):Promise<BrowserEvidence> {
  const began=performance.now();
  const knownControls=new Set<string>();
  for(const [width,height] of [[320,700],[390,700],[844,390]]){
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2,hasTouch:true,isMobile:true,offline:true,serviceWorkers:'block',acceptDownloads:false});
    let failure='',phase='load';
    try{
      const page=await context.newPage();page.setDefaultTimeout(1500);
      page.on('pageerror',()=>{failure='JAVASCRIPT_EXCEPTION';});
      page.on('console',m=>{if(m.type()==='error')failure||='BROWSER_CONSOLE_ERROR';});
      page.on('dialog',d=>{failure||='NATIVE_DIALOG';void d.dismiss();});
      context.on('page',p=>{if(p!==page){failure||='POPUP';void p.close();}});
      await context.route('**/*',r=>{failure||='NETWORK_ATTEMPT';return r.abort();});
      const content='<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="'+GAME_CSP+'"><script>'+UUID_COMPAT+'</script>'+html;
      await page.setContent('<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>');
      await page.locator('iframe').evaluate((node,content)=>{(node as HTMLIFrameElement).srcdoc=content;},content);
      const frame=await (await page.locator('iframe').elementHandle())!.contentFrame();
      if(!frame)throw new Fault('BROWSER_CHECK_INCONCLUSIVE',502);
      await frame.waitForURL('about:srcdoc',{waitUntil:'load'});await page.waitForTimeout(100);
      phase='layout';const visible=await frame.evaluate(()=>({width:document.body?.getBoundingClientRect().width??0,height:document.body?.getBoundingClientRect().height??0,overflow:document.documentElement.scrollWidth>innerWidth+2,content:!!document.querySelector('canvas,svg,button,input')||!!document.body?.innerText.trim()}));
      if(!visible.content||visible.width<20||visible.height<20)throw new Fault('BROWSER_GAME_AREA',502);
      if(visible.overflow)throw new Fault('BROWSER_HORIZONTAL_OVERFLOW',502);
      phase='start-control';const start=frame.getByRole('button',{name:/^(start|play|начать(?: игру)?|старт|играть)$/i}).filter({visible:true});
      if(await start.count()===1&&await start.evaluate(activeElement))await start.tap();
      phase='control-reachability';await checkControlReachability(frame,knownControls,width===844);
      phase='touch-input';const input=frame.locator('canvas:visible,button:visible:enabled,[role="grid"]:visible');
      for(let i=0,n=Math.min(64,await input.count());i<n;i++)if(await input.nth(i).evaluate(activeElement)){await input.nth(i).tap();break;}
      // This is a phone probe: keyboard input would hide missing touch controls.
      // Probe real visible action controls, but never infer rules from pixels.
      phase='action-controls';const actions=frame.getByRole('button').filter({visible:true});
      for(let i=0,n=Math.min(3,await actions.count());i<n;i++)if(await actions.nth(i).isVisible()&&await actions.nth(i).isEnabled()&&await actions.nth(i).evaluate(activeElement))await actions.nth(i).tap();
      await page.waitForTimeout(100);
      phase='restart';const restart=frame.getByRole('button',{name:/^(restart|replay|перезапуск|заново|начать заново|повторить)$/i}).filter({visible:true});
      if(await restart.count()===1&&await restart.evaluate(activeElement)){await restart.tap();await page.waitForTimeout(100);}
      if(failure)throw new Fault(failure,502);
      // An additional standalone offline load checks that parent init is optional.
      phase='standalone';await page.goto('about:blank');await page.setContent(content);await page.waitForTimeout(100);
      if(failure)throw new Fault(failure,502);
      if(signal.aborted)throw new Fault('BROWSER_TIMEOUT',504);
    }catch(error){
      if(failure)throw Object.assign(new Fault(failure,502),{validationPhase:phase,profileWidth:width,profileHeight:height});
      if(error instanceof Fault)throw Object.assign(error,{validationPhase:phase,profileWidth:width,profileHeight:height});
      throw Object.assign(new Fault(signal.aborted?'BROWSER_TIMEOUT':'BROWSER_CHECK_INCONCLUSIVE',502),{validationPhase:phase,profileWidth:width,profileHeight:height});
    }finally{await context.close().catch(()=>{});}
  }
  return {profiles:[320,390,844],offline:true,errors:0,scope:'full-html',levels:['HTML_VALID','JS_EXECUTABLE','UI_VISIBLE','MOBILE_VERIFIED'],elapsedMs:Math.round(performance.now()-began),checks:([
    'html-runs','input-works','gameplay-observed','win-reachable','loss-reachable','restart-works'
  ] as const).map(aspect=>({aspect,level:aspect==='html-runs'?'VERIFIED':'NOT_VERIFIED'}))};
}
