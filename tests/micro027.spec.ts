import {test,expect} from '@playwright/test';
import {browserCheck} from '../src/browser-check.ts';
import {serve} from '@hono/node-server';
import {createServer} from 'node:http';
import {mkdtempSync} from 'node:fs';
import {CloudTransport} from '../src/transport.ts';
import {GenerationEngine} from '../src/live.ts';
import {GenerationJobs} from '../src/jobs.ts';
import {Store} from '../src/store.ts';
import {createApp} from '../src/api.ts';
import {PhoneConnection} from '../src/phone.ts';
import {lanAddresses} from '../src/network.ts';
import {strictCanvas} from './strict-canvas-fixtures.ts';
const html=strictCanvas();
import jsQR from 'jsqr';
import {PNG} from 'pngjs';
import {prepareSyntheticProviderUI} from './ui-jobs-helper.ts';
test('MICRO-027 critical runtime error survives a later actionability timeout',async()=>{
 const html=`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{min-height:200px}button{pointer-events:none}</style></head><body><button>Start</button><script>throw Error('critical fixture');</script></body></html>`;
 await expect(browserCheck(html,AbortSignal.timeout(18000))).rejects.toMatchObject({code:'JAVASCRIPT_EXCEPTION'});
});

test('MICRO-027 actual UI job, diagnostics, version edit, export and exact-version phone QR',async({page,browser},info)=>{
 test.setTimeout(60000);test.skip(!info.project.name.startsWith('chromium'),'Chromium UI scenario; WebKit phone coverage is in phone.spec.ts.');
 const host=lanAddresses()[0]?.address;test.skip(!host,'No private IPv4');
 let posts=0;const upstream=createServer((req,res)=>{if(req.method==='GET'){res.end(JSON.stringify({data:[{id:'gemma4:31b'}]}));return;}posts++;res.end('data: '+JSON.stringify({model:'gemma4:31b',choices:[{delta:{content:html},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');});
 await new Promise<void>(r=>upstream.listen(0,'127.0.0.1',r));
 const original=globalThis.fetch;globalThis.fetch=((input:any,init?:RequestInit)=>{const url=new URL(input instanceof Request?input.url:input);if(url.origin==='https://ollama.com')return original('http://127.0.0.1:'+(upstream.address() as {port:number}).port+url.pathname,{...init,dispatcher:undefined} as RequestInit);if(!['127.0.0.1',host].includes(url.hostname))throw Error('TEST_EXTERNAL_FORBIDDEN');return original(input,init);}) as typeof fetch;
 const directory=mkdtempSync('.local/micro027-ui-'),store=new Store(directory+'/data.sqlite');
 const engine=new GenerationEngine([new CloudTransport({base:'https://ollama.com/v1',model:'gemma4:31b',key:'synthetic'})],{repairs:0});
 const jobs=new GenerationJobs(store,engine,undefined,true,{maxCalls:1}),phone=new PhoneConnection(store,async()=>[{name:'controlled inventory',address:host}],Date.now,undefined,0);
 const app=createApp(store,engine,undefined,undefined,undefined,undefined,jobs,phone),server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0});await new Promise<void>(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+(server.address() as {port:number}).port,guest=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true}),mobile=await guest.newPage();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));mobile.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(base);await prepareSyntheticProviderUI(page);await page.locator('#provider-mode').selectOption('ollama-cloud');await page.locator('#prompt').fill('Synthetic transport: collect points');
  const submitted=page.waitForResponse(r=>r.url()===base+'/api/jobs'&&r.request().method()==='POST');await page.locator('#generate').click();const first=await(await submitted).json() as {jobId:string};await expect.poll(()=>jobs.get('owner',first.jobId).stage,{timeout:20000}).toBe('completed');await expect(page.locator('#game iframe')).toBeVisible();
  const report=await(await page.request.get(base+'/api/jobs/'+first.jobId+'/diagnostics')).json();expect(report.events.some((event:{event:string})=>event.event==='job.completed')).toBe(true);
  const frame=page.frameLocator('#game iframe');const canvas=frame.locator('canvas');await canvas.click();const before=await canvas.evaluate(c=>(c as HTMLCanvasElement).toDataURL());await canvas.click();expect(await canvas.evaluate(c=>(c as HTMLCanvasElement).toDataURL())).not.toBe(before);
  const version=(await(await page.request.get(base+'/api/jobs/'+first.jobId)).json()).versionId;expect(await(await page.request.get(base+'/api/versions/'+version+'/export')).text()).toBe(html.trim());
  await page.reload();await expect(frame.locator('canvas')).toBeVisible();await page.locator('#phone-game').click();await expect(page.locator('#phone-qr')).toBeVisible();await expect.poll(async()=>{const qr=(await page.locator('#phone-qr').boundingBox())!,header=(await page.locator('header').boundingBox())!;return qr.y>=Math.max(0,header.y+header.height)&&qr.y+qr.height<=page.viewportSize()!.height;}).toBe(true);const png=PNG.sync.read(await page.locator('#phone-qr').screenshot({path:info.outputPath('phone-qr.png')}));const decoded=(jsQR as unknown as (data:Uint8ClampedArray,w:number,h:number)=>{data:string}|null)(new Uint8ClampedArray(png.data),png.width,png.height);expect(decoded).not.toBeNull();expect((await(await page.request.get(base+'/api/phone')).json()).versionId).toBe(version);
  await mobile.goto(decoded!.data);const touch=mobile.frameLocator('#game iframe');const touchCanvas=touch.locator('canvas');await touchCanvas.tap();const touchBefore=await touchCanvas.evaluate(c=>(c as HTMLCanvasElement).toDataURL());await touchCanvas.tap();expect(await touchCanvas.evaluate(c=>(c as HTMLCanvasElement).toDataURL())).not.toBe(touchBefore);await mobile.getByRole('button',{name:'Запустить заново',exact:true}).click();await expect(touch.locator('canvas')).toBeVisible();await mobile.setViewportSize({width:844,height:390});expect(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await mobile.screenshot({path:info.outputPath('phone.png')});
  await page.locator('#phone-off').click();await expect(page.locator('#phone-ready')).toBeHidden();await page.locator('#games button[data-version="'+version+'"]').click();await page.locator('#edit-game').click();await page.locator('#change').fill('Keep all controls and add a label');const editSubmit=page.waitForResponse(r=>r.url()===base+'/api/jobs'&&r.request().method()==='POST');await page.locator('#improve').click();const edited=await(await editSubmit).json() as {jobId:string};await expect.poll(()=>jobs.get('owner',edited.jobId).stage,{timeout:20000}).toBe('completed');await expect(page.locator('#job-toast-text')).toContainText('Keep all controls');await page.locator('#job-toast-open').click();await expect.poll(()=>store.history(store.getVersion(version).gameId).length,{timeout:20000}).toBe(2);expect(store.getVersion(version).html).toBe(html.trim());expect(posts).toBe(2);const latest=store.history(store.getVersion(version).gameId).at(-1)!.versionId;await page.locator('#phone-game').click();await expect(page.locator('#phone-version')).toHaveValue(latest);await expect(page.locator('#phone-version')).toBeEnabled();await expect.poll(async()=>(await(await page.request.get(base+'/api/phone')).json()).versionId).toBe(latest);expect(errors).toEqual([]);await page.screenshot({path:info.outputPath('ui-delivery.png'),fullPage:true});
 }finally{globalThis.fetch=original;await guest.close();await phone.close();await jobs.close();if('closeAllConnections' in server)server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));store.close();upstream.closeAllConnections();await new Promise<void>(r=>upstream.close(()=>r()));}
});

// Native-language Start controls must be exercised before tapping the canvas.
test('MICRO-027 Russian Start dismisses an opaque overlay before input probe',async()=>{
 const source='<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;min-height:300px}canvas{width:200px;height:200px}#cover{position:fixed;inset:0;background:white}</style></head><body><canvas></canvas><div id="cover"><button onclick="document.querySelector(\'#cover\').remove()">Начать игру</button></div><script>const surface=document.querySelector("canvas"),ctx=surface.getContext("2d");let x=20;function draw(){ctx.fillStyle="#142038";ctx.fillRect(0,0,300,150);ctx.fillStyle="#ffcc40";ctx.fillRect(x,40,50,60);}draw();surface.addEventListener("pointerdown",()=>{x=x===20?100:20;draw();});</script></body></html>';
 await expect(browserCheck(source,AbortSignal.timeout(18000))).rejects.toMatchObject({code:'BROWSER_DOM_GAME_UI'});
});
