import {test,expect} from '@playwright/test';
import {checkFullHtml} from '../src/full-html-check.ts';
import {strictCanvas} from './strict-canvas-fixtures.ts';
import {canvasGame} from './canvas-fixtures.ts';
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
