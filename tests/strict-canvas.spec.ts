import {test,expect} from '@playwright/test';
import {checkFullHtml} from '../src/full-html-check.ts';
import {strictCanvas} from './strict-canvas-fixtures.ts';
import {canvasGame} from './canvas-fixtures.ts';
import {observeCanvas,canvasSnapshot,requireCanvas} from '../src/canvas-check.ts';
test.beforeEach(({},info)=>test.skip(info.project.name!=='chromium-desktop','Production validator uses Chromium.'));
test('strict Canvas rejects a visible HTML HUD',async({browser})=>{
 const source=canvasGame(); // Previously accepted visible HTML Start/Move/HUD.
 await expect(checkFullHtml(browser,source,AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_DOM_GAME_UI'});
});
for(const kind of ['2d','webgl','webgl2'])test('strict Canvas accepts '+kind+' UI, DPR, landscape and repeated touch',async({browser})=>{
 const evidence=await checkFullHtml(browser,strictCanvas(kind),AbortSignal.timeout(18000));
 expect(evidence.rendering).toMatchObject({contract:'canvas-webgl-strict-v2',profiles:[320,390,844]});
 expect(evidence.rendering!.contexts).toContain(kind);
});
const insert=(markup:string)=>strictCanvas().replace('<body>','<body>'+markup);
const dynamic=(code:string)=>strictCanvas().replace('step++;draw();','step++;'+code+'draw();');
for(const [name,source] of [
 ['animated canvas and DOM gameplay',insert('<button>Move</button>')],
 ['HTML Start and Restart',insert('<button>Start</button><button>Restart</button>')],
 ['HTML HUD',insert('<output>Lives 3</output>')],
 ['DOM Game Over',insert('<section role="dialog">Game Over</section>')],
 ['CSS Grid world',insert('<div style="display:grid"><div style="background:red;width:20px;height:20px"></div></div>')],
 ['SVG',insert('<svg width="40" height="40"><rect width="40" height="40"/></svg>')],
 ['pseudo interface',insert('<style>body::before{content:"Pause";position:fixed;top:0}</style>')],
 ['pseudo on zero-size host',insert('<style>i::before{content:"Pause";position:fixed;left:0;top:0}</style><i style="display:block;width:0;height:0"></i>')],
 ['absolute pseudo on zero-size host',insert('<style>i::before{content:"Pause";position:absolute;left:0;top:0}</style><i style="display:block;width:0;height:0"></i>')],
 ['text in display contents',insert('<span style="display:contents">HUD</span>')],
 ['overflowing text in zero-size host',insert('<span style="display:block;width:0;height:0">HUD</span>')],
 ['native sound controls',insert('<audio controls style="position:fixed;top:0;left:0"></audio>')],
 ['fixed UI escapes ordinary clipping',insert('<div style="width:0;height:0;overflow:hidden"><button style="position:fixed;top:0;left:0">Pause</button></div>')],
 ['absolute UI escapes ordinary clipping',insert('<div style="width:0;height:0;overflow:hidden"><button style="position:absolute;top:0;left:0">Pause</button></div>')],
 ['dynamic menu',dynamic('if(step===1)document.body.insertAdjacentHTML("afterbegin","<nav>Menu</nav>");')],
 ['dynamic HUD',dynamic('if(step===2)document.body.insertAdjacentHTML("afterbegin","<output>Score 2</output>");')],
 ['victory overlay',dynamic('if(step===4)document.body.insertAdjacentHTML("afterbegin","<section role=dialog>You won</section>");')],
 ['invisible canvas DOM game',insert('<button>Play</button>').replace('canvas{display:block','canvas{display:none')],
 ['HTML after Restart',strictCanvas().replace('step=0;paused=false;draw();','step=0;paused=false;document.body.insertAdjacentHTML("afterbegin","<button>Move</button>");draw();')],
 ['raw text',insert('Score 1')],
 ['CSS background',insert('<div style="position:fixed;top:0;width:40px;height:40px;background:linear-gradient(red,blue)"></div>')],
 ['ARIA role',insert('<custom-hud role="status">Score 1</custom-hud>')],
 ['open shadow',insert('<custom-hud></custom-hud>').replace('let active=', 'document.querySelector("custom-hud").attachShadow({mode:"open"}).innerHTML="<span>Lives 3</span>";let active=')],
 ['closed shadow',insert('<custom-hud></custom-hud>').replace('let active=', 'document.querySelector("custom-hud").attachShadow({mode:"closed"}).innerHTML="<span>Lives 3</span>";let active=')],
 ['nested document',insert('<iframe srcdoc="<p>HUD</p>"></iframe>')],
] as const)test('strict Canvas rejects '+name,async({browser})=>{
 await expect(checkFullHtml(browser,source,AbortSignal.timeout(18000))).rejects.toMatchObject({code:expect.stringMatching(/BROWSER_DOM_GAME_UI|NETWORK_ATTEMPT|BROWSER_CONSOLE_ERROR/)});
});
test('strict Canvas allows transparent structure and invisible technical resources',async({browser})=>{
 const source=strictCanvas().replace('<canvas aria-label="Game">','<div><canvas aria-label="Game">').replace('</canvas>','</canvas></div><span hidden>Technical text</span><canvas hidden></canvas>')
  .replace('canvas{display:block','[hidden]{display:none!important}div{width:100%;height:100%}canvas{display:block');
 await expect(checkFullHtml(browser,source,AbortSignal.timeout(18000))).resolves.toMatchObject({rendering:{contract:'canvas-webgl-strict-v2'}});
});
for(const code of ['return;','step++;','draw();'])test('strict Canvas leaves inert interaction NOT_VERIFIED: '+code,async({browser})=>{
 const source=strictCanvas().replace('function act(){','function act(){'+code+'return;');
 await expect(checkFullHtml(browser,source,AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_CANVAS_ACTIVITY_UNVERIFIED'});
});
test('strict Canvas detects exceptions after Start',async({browser})=>{
 await expect(checkFullHtml(browser,strictCanvas().replace('active=true;draw();return;','throw Error("start failure");'),AbortSignal.timeout(18000))).rejects.toMatchObject({code:'JAVASCRIPT_EXCEPTION'});
});
test('opaque pointer-transparent Canvas cannot expose a changing world underneath',async({browser})=>{
 const source=strictCanvas('webgl').replace('ctx.clearRect(0,0,w,h);',"ctx.fillStyle='#142038';ctx.fillRect(0,0,w,h);")
  .replace("ctx.fillRect(20+(step%5)*30,h*.6,40,40);","ctx.fillRect(20,h*.6,40,40);").replace("'Score '+step+' Lives 3'","'Score 0 Lives 3'")
  .replace("!active?'Start':step>=4?'Game Over / Restart':'Move'","'Static decoration'");
 await expect(checkFullHtml(browser,source,AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_CANVAS_ACTIVITY_UNVERIFIED'});
});
test('strict Canvas permits an offscreen technical pseudo-element',async({browser})=>{
 const source=insert('<style>i::before{content:"technical";position:absolute;left:-10000px;top:0}</style><i style="display:block;width:0;height:0"></i>');
 await expect(checkFullHtml(browser,source,AbortSignal.timeout(18000))).resolves.toMatchObject({rendering:{contract:'canvas-webgl-strict-v2'}});
});
test('strict Canvas permits transparent nonvisual pseudo content',async({browser})=>{
 const source=insert('<style>i::before{content:"technical";color:rgba(255,0,0,0)}</style><i style="display:block;width:0;height:0"></i>');
 await expect(checkFullHtml(browser,source,AbortSignal.timeout(18000))).resolves.toMatchObject({rendering:{contract:'canvas-webgl-strict-v2'}});
});
for(const [name,markup] of [
 ['in-flow pseudo on zero box','<style>i::before{content:"Pause"}</style><i style="display:block;width:0;height:0"></i>'],
 ['shadow on zero box','<i style="display:block;width:0;height:0;box-shadow:0 0 0 30px red"></i>'],
 ['outline decoration','<i style="display:block;width:30px;height:30px;outline:3px solid red"></i>'],
 ['overflowing SVG child','<svg style="width:0;height:0;overflow:visible"><rect width="40" height="40"/></svg>'],
] as const)test('strict Canvas refuses unsupported or visible paint: '+name,async({browser})=>{
 await expect(checkFullHtml(browser,insert(markup),AbortSignal.timeout(18000))).rejects.toMatchObject({code:expect.stringMatching(/BROWSER_DOM_GAME_UI|BROWSER_CANVAS_DOM_UNVERIFIED/)});
});
test('strict Canvas classifies zero backing size before coordinate probes',async({browser})=>{
 const source=strictCanvas().replace('c.width=Math.round(r.width*devicePixelRatio)','c.width=0');
 await expect(checkFullHtml(browser,source,AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_CANVAS_LAYOUT'});
});
test('strict Canvas rejects technical head content made visible by CSS',async({browser})=>{
 const source=strictCanvas().replace('<head>','<head><title>HUD</title><style>head,title{display:block}</style>');
 await expect(checkFullHtml(browser,source,AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_DOM_GAME_UI'});
});
for(const [name,source] of [
 ['declarative closed root',strictCanvas().replace('<body>','<body><div><template shadowrootmode="closed"><span>HUD</span></template></div>')],
 ['native shadow parser after input',strictCanvas().replace('step++;draw();',`step++;if(step===1){const host=document.createElement('div');host.style.cssText='position:fixed;top:0';host.setHTMLUnsafe('<template shadowrootmode="closed"><span>HUD</span></template>');document.body.append(host);}draw();`)],
 ['document stream parser',strictCanvas().replace('let active=false',`document.write('<div style="position:fixed;top:0"><template shadowrootmode="closed"><span>HUD</span></template></div>');let active=false`)],
] as const)test('strict Canvas leaves unobservable shadow parsing NOT_VERIFIED: '+name,async({browser})=>{
 await expect(checkFullHtml(browser,source,AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_CANVAS_DOM_UNVERIFIED'});
});

for(const [name,markup] of [
 ['visible list marker',`<li style="position:fixed;left:160px;top:5px;width:1px;height:25px;list-style-type:'Score 100';color:white;font-size:20px"></li>`],
 ['zero-size positioned pseudo text','<style>#probe::before{content:"Pause";position:fixed;left:0;top:0;width:0;height:0;overflow:visible;color:white;font-size:20px}</style><div id="probe"></div>'],
] as const)test('A1.8.7 refuses visible DOM paint: '+name,async({browser})=>{
 await expect(checkFullHtml(browser,insert(markup),AbortSignal.timeout(18000))).rejects.toMatchObject({code:expect.stringMatching(/BROWSER_DOM_GAME_UI|BROWSER_CANVAS_DOM_UNVERIFIED/)});
});

for(const [name,markup] of [
 ['hidden list','<li hidden>technical</li>'],
 ['invisible marker','<li style="position:fixed;left:160px;top:5px;color:transparent"></li>'],
 ['no marker','<li style="list-style:none"></li>'],
 ['empty marker type',`<li style="list-style-type:''"></li>`],
 ['zero font marker','<li style="font-size:0"></li>'],
 ['suppressed marker','<style>li::marker{content:none}</style><li></li>'],
 ['transparent generated marker','<style>li::marker{content:"technical";color:transparent}</style><li></li>'],
 ['no pseudo content','<style>#probe::before{content:none}</style><div id="probe"></div>'],
 ['transparent zero pseudo','<style>#probe::before{content:"technical";position:fixed;left:0;top:0;width:0;height:0;color:transparent}</style><div id="probe"></div>'],
 ['clipped zero pseudo','<style>#probe::before{content:"technical";position:fixed;left:0;top:0;width:0;height:0;overflow:hidden}</style><div id="probe"></div>'],
 ['offscreen clipped pseudo','<style>#probe::before{content:"technical";position:fixed;left:-10000px;top:0;width:100px;height:30px;overflow:hidden}</style><div id="probe"></div>'],
] as const)test('A1.8.8 permits nonvisual CSS: '+name,async({browser})=>{
 await expect(checkFullHtml(browser,insert(markup),AbortSignal.timeout(18000))).resolves.toMatchObject({rendering:{contract:'canvas-webgl-strict-v2'}});
});

const marker='<li style="position:fixed;left:160px;top:5px;list-style-type:decimal;color:white"></li>';
const pseudo='<style>#probe::before{content:"Pause";position:fixed;left:0;top:0;width:0;height:0;overflow:visible;color:white}</style><div id="probe"></div>';
for(const [paint,markup] of [['marker',marker],['pseudo',pseudo]] as const){
 test('A1.8.8 '+paint+' refuses at each production viewport with rendered Canvas',async({browser})=>{
  for(const viewport of [{width:320,height:700},{width:390,height:700},{width:844,height:390}]){
   const context=await browser.newContext({viewport,offline:true});
   try{
    const source=insert(markup),key='cssPaintProbe';
    await context.addInitScript(observeCanvas,{key,html:source});
    await context.route('**/*',r=>r.request().url()==='https://css-probe.invalid/'?r.fulfill({contentType:'text/html',body:source}):r.abort());
    const page=await context.newPage();await page.goto('https://css-probe.invalid/');
    const snapshot=await canvasSnapshot(page.mainFrame(),key);
    expect(snapshot.dom).toBe(-1);expect(snapshot.canvases).toEqual([expect.objectContaining({context:'2d',meaningful:true,fits:true,draws:expect.any(Number)})]);
    expect(snapshot.canvases[0].draws).toBeGreaterThan(0);
    expect(()=>requireCanvas([snapshot],false)).toThrow('BROWSER_CANVAS_DOM_UNVERIFIED');
   }finally{await context.close();}
  }
 });
 test('A1.8.8 refuses '+paint+' revealed by real scrolling',async({browser})=>{
  const source=insert('<div id="scroll" style="position:fixed;inset:0;overflow:auto"><div style="height:2000px"></div></div>')
   .replace('let active=false',`document.querySelector('#scroll').addEventListener('scroll',()=>document.body.insertAdjacentHTML('afterbegin',${JSON.stringify(markup)}),{once:true});let active=false`);
  await expect(checkFullHtml(browser,source,AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_CANVAS_DOM_UNVERIFIED'});
 });
 for(const [phase,trigger] of [['Start','active=true;'],['input','step++;'],['Game Over','step++;'],['Restart','step=0;paused=false;']] as const){
  const source=strictCanvas().replace(trigger,trigger+(phase==='Game Over'?'if(step===4)':'')+`document.body.insertAdjacentHTML('afterbegin',${JSON.stringify(markup)});`);
  test('A1.8.8 refuses '+paint+' after '+phase,async({browser})=>{
   await expect(checkFullHtml(browser,source,AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_CANVAS_DOM_UNVERIFIED'});
  });
 }
}

for(const [name,markup] of [
 ['inherited marker','<ul style="list-style-type:decimal"><li style="position:fixed;left:160px;top:5px;color:white"></li></ul>'],
 ['generated marker','<style>li::marker{content:"Score"}</style><li style="position:fixed;left:160px;top:5px;color:white;list-style:none"></li>'],
 ['marker image','<li style="position:fixed;left:160px;top:5px;list-style-type:none;list-style-image:linear-gradient(red,blue)"></li>'],
 ['clipped host escapes fixed pseudo','<style>#probe::before{content:"Pause";position:fixed;left:0;top:0;width:0;height:0;overflow:visible;color:white}</style><div id="probe" style="width:0;height:0;overflow:hidden"></div>'],
] as const)test('A1.8.8 refuses ambiguous CSS paint: '+name,async({browser})=>{
 await expect(checkFullHtml(browser,insert(markup),AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_CANVAS_DOM_UNVERIFIED'});
});
