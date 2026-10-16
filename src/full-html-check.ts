import type { Browser } from 'playwright-core';
import { Fault } from './contracts.ts';
import { GAME_CSP, UUID_COMPAT } from './runtime.ts';
import type { BrowserEvidence } from './browser-check.ts';

/** Bounded technical checks for arbitrary standalone games, without game-specific
 * selectors, telemetry, state injection or JavaScript rewriting. */
export async function checkFullHtml(browser:Browser,html:string,signal:AbortSignal):Promise<BrowserEvidence> {
  const began=performance.now();
  for(const width of [320,390]){
    const context=await browser.newContext({viewport:{width,height:700},deviceScaleFactor:2,hasTouch:true,isMobile:true,offline:true,serviceWorkers:'block',acceptDownloads:false});
    try{
      const page=await context.newPage();page.setDefaultTimeout(1500);
      let failure='';
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
      await frame.waitForLoadState('load');await page.waitForTimeout(100);
      const visible=await frame.evaluate(()=>({width:document.body?.getBoundingClientRect().width??0,height:document.body?.getBoundingClientRect().height??0,overflow:document.documentElement.scrollWidth>innerWidth+2,content:!!document.querySelector('canvas,svg,button,input')||!!document.body?.innerText.trim()}));
      if(!visible.content||visible.width<20||visible.height<20)throw new Fault('BROWSER_GAME_AREA',502);
      if(visible.overflow)throw new Fault('BROWSER_HORIZONTAL_OVERFLOW',502);
      const start=frame.getByRole('button',{name:/^(start|play|начать(?: игру)?|старт|играть)$/i}).filter({visible:true});
      if(await start.count()===1)await start.tap();
      const input=frame.locator('canvas:visible,button:visible:enabled,[role="grid"]:visible');
      if(await input.count())await input.first().tap();
      // This is a phone probe: keyboard input would hide missing touch controls.
      // Probe real visible action controls, but never infer rules from pixels.
      const actions=frame.getByRole('button').filter({visible:true});
      for(let i=0,n=Math.min(3,await actions.count());i<n;i++)if(await actions.nth(i).isVisible()&&await actions.nth(i).isEnabled())await actions.nth(i).tap();
      await page.waitForTimeout(100);
      const restart=frame.getByRole('button',{name:/^(restart|replay|перезапуск|заново|начать заново|повторить)$/i}).filter({visible:true});
      if(await restart.count()===1){await restart.tap();await page.waitForTimeout(100);}
      if(failure)throw new Fault(failure,502);
      // An additional standalone offline load checks that parent init is optional.
      await page.goto('about:blank');await page.setContent(content);await page.waitForTimeout(100);
      if(failure)throw new Fault(failure,502);
      if(signal.aborted)throw new Fault('BROWSER_TIMEOUT',504);
    }catch(error){
      if(error instanceof Fault)throw error;
      throw new Fault(signal.aborted?'BROWSER_TIMEOUT':'BROWSER_CHECK_INCONCLUSIVE',502);
    }finally{await context.close().catch(()=>{});}
  }
  return {profiles:[320,390],offline:true,errors:0,scope:'full-html',levels:['HTML_VALID','JS_EXECUTABLE','UI_VISIBLE','MOBILE_VERIFIED'],elapsedMs:Math.round(performance.now()-began),checks:([
    'html-runs','input-works','gameplay-observed','win-reachable','loss-reachable','restart-works'
  ] as const).map(aspect=>({aspect,level:aspect==='html-runs'?'VERIFIED':'NOT_VERIFIED'}))};
}
