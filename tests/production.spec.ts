import {strictCanvas} from './strict-canvas-fixtures.ts';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createAndOpen} from './ui-jobs-helper.ts';
import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { lanAddresses } from '../src/network.ts';
import { productionServer } from './production-helper.ts';
import { artifact, spec } from './helpers.ts';
import { Store } from '../src/store.ts';

test.beforeEach(({},info)=>{test.skip(!['chromium-desktop','chromium-320','webkit-390'].includes(info.project.name),'Production coverage on desktop Chromium and small Chromium/WebKit. Other profiles run full runtime/mobile suites.');});

test('production client disconnect leaves the durable job running and stores its checked game',async()=>{
 let started!:()=>void;const began=new Promise<void>(done=>started=done);
 const upstream=createServer((req,res)=>{if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'gemma4:31b'}]}));return;}res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify({model:'gemma4:31b',choices:[{delta:{content:strictCanvas()},finish_reason:'stop'}]})+'\n\n');setTimeout(()=>res.end('data: [DONE]\n\n'),30);started();});await new Promise<void>(done=>upstream.listen(0,'127.0.0.1',done));
 const server=await productionServer('127.0.0.1',synthetic('http://127.0.0.1:'+(upstream.address() as any).port));
 try{
  const response=await fetch(server.url+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({spec,mode:'live',providerMode:'ollama-cloud',idempotencyKey:'production-disconnect-test'})});expect(response.status).toBe(202);const created=await response.json() as {jobId:string};
  await Promise.race([began,new Promise<void>((_,reject)=>setTimeout(()=>reject(Error('UPSTREAM_NOT_STARTED')),5000).unref())]);
  await expect.poll(async()=>((await(await fetch(server.url+'/api/jobs/'+created.jobId)).json()) as {stage:string}).stage,{timeout:15000}).toBe('completed');expect((await(await fetch(server.url+'/api/games')).json()).games).toHaveLength(1);
 }finally{await server.stop();server.cleanup();upstream.closeAllConnections();await new Promise<void>(done=>upstream.close(()=>done()));}
});

test('real production LAN: authentication, QR independent decode, relative API, gameplay, restart and changed port', async({page,context},info)=>{
  // Two server startups, QR decodes and full win/loss/restart flows share this
  // test. Windows run 38862850604 reached the last export assertion at 20s.
  test.setTimeout(process.platform==='win32'?45000:20000);
  const host=lanAddresses()[0]?.address;test.skip(!host,'No private IPv4 interface available on this runner.');
  const key=randomBytes(32).toString('base64url'),env={YAPLIX_MODE:'lan',YAPLIX_ACCESS_KEY:key},directory=mkdtempSync(resolve('.local/production-lan-'));
  const seed=new Store(resolve(directory,'data.sqlite')),version=seed.save(spec,artifact);seed.close();
  let server=await productionServer(host,env,directory);
  const errors:string[]=[],apiOrigins:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))apiOrigins.push(new URL(r.url()).origin);});
  const decode=async()=>{await page.locator('#system summary').click();await expect(page.locator('#system-info')).toContainText('API: ответ получен');await page.getByRole('button',{name:'Показать QR',exact:true}).click();await expect(page.locator('#qr-image')).toBeVisible();const png=PNG.sync.read(await page.locator('#qr-image').screenshot());const result=(jsQR as unknown as (data:Uint8ClampedArray,width:number,height:number)=>{data:string}|null)(new Uint8ClampedArray(png.data),png.width,png.height);expect(result).not.toBeNull();return result!.data;};
  try {
    expect((await page.request.get(server.url+'/api/connection/qr.svg')).status()).toBe(401);
    await page.goto(server.url);await page.locator('#access-key').fill('wrong');await page.getByRole('button',{name:'Войти',exact:true}).click();await expect(page.locator('#access-message')).toContainText('Ключ не принят');
    await page.locator('#access-key').fill(key);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.locator('[data-view="library"]:visible').click();
    const decoded=await decode();expect(decoded).toBe(server.url+'/');expect(decoded).not.toContain(key);expect(new URL(decoded).search).toBe('');expect(new URL(decoded).hash).toBe('');
    await page.locator('#games button[data-version="'+version.versionId+'"]').click();await expect(page.locator('#game iframe')).toBeVisible();
    const game=page.frameLocator('#game iframe');await game.getByRole('button',{name:'Start',exact:true}).click();
    await game.getByRole('button',{name:'Point',exact:true}).click();await expect(game.locator('#score')).toHaveText('1');
    await game.getByRole('button',{name:'Point',exact:true}).click();await game.getByRole('button',{name:'Point',exact:true}).click();await expect(game.locator('#status')).toHaveText('Won');await expect(page.locator('#analytics')).toContainText('Победы: 1');
    await page.locator('#replay').click();await game.getByRole('button',{name:'Start',exact:true}).click();await game.getByRole('button',{name:'Trap',exact:true}).click();await expect(game.locator('#status')).toHaveText('Lost');await expect(page.locator('#analytics')).toContainText('Поражения: 1');
    const exportPath=await page.locator('#export').getAttribute('href');const firstOrigin=server.url;
    expect(apiOrigins.every(origin=>origin===firstOrigin)).toBe(true);expect(errors).toEqual([]);
    await page.screenshot({path:info.outputPath('production-lan.png'),fullPage:true});
    await server.stop();server=await productionServer(host,env,directory);expect(server.url).not.toBe(firstOrigin);
    await context.clearCookies();await page.goto(server.url);await page.locator('#access-key').fill(key);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.locator('[data-view="library"]:visible').click();
    expect(await decode()).toBe(server.url+'/');expect((await page.request.get(server.url+exportPath)).status()).toBe(200);
    await page.locator('[data-view="library"]:visible').click();await page.locator('#games button[data-version="'+version.versionId+'"]').click();await expect(page.locator('#analytics')).toContainText('Победы: 1');
  } finally { await server.stop();server.cleanup(); }
});

for(const scenario of ['success','repair','unsafe','http-error','timeout','unavailable'] as const)test('production LIVE '+scenario+' (synthetic transport, no model-quality claim)',async({page})=>{
  test.setTimeout(35000);
  let calls=0;const model='gemma4:31b';
  const mock=createServer((req,res)=>{
    if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:model}]}));return;}
    calls++;if(scenario==='timeout')return;
    if(scenario==='http-error'){res.statusCode=500;res.end('{}');return;}
    const unsafe= scenario==='unsafe'||scenario==='repair'&&calls===1;
    const content=unsafe?strictCanvas().replace('</html>','<script>alert("win")</script></html>'):strictCanvas();res.end('data: '+JSON.stringify({model,choices:[{delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(done=>mock.listen(0,'127.0.0.1',done));const port=(mock.address() as {port:number}).port;
  if(scenario==='unavailable')await new Promise<void>(done=>mock.close(()=>done()));
  const server=await productionServer('127.0.0.1',{...synthetic(`http://127.0.0.1:${port}`),LLM_MAX_ATTEMPTS:scenario==='repair'||scenario==='unsafe'?'2':'1',LLM_AUTO_REPAIR:'1',LLM_REPAIRS:'1',LLM_MAX_DURATION_MS:'180000',LLM_REQUEST_TIMEOUT_MS:scenario==='timeout'?'1000':'60000'});
  try {
    await page.route('**/api/providers/ollama-cloud/check',route=>route.fulfill({json:{mode:'ollama-cloud',model,configured:true,ready:true,state:'ready',reasonCode:null}}));
    await page.goto(server.url);await page.getByRole('button',{name:'Создать',exact:true}).click();
    if(scenario==='success'||scenario==='repair')await createAndOpen(page,'Создать игру',false);
    else{await page.locator('#prompt').fill('Synthetic failure scenario');const settings=page.locator('details.tune').first();if(!await page.locator('#check-provider').isVisible())await settings.locator('summary').click();const readiness=page.waitForResponse(response=>response.url().includes('/api/providers/ollama-cloud/check'));await Promise.all([readiness,page.locator('#check-provider').click()]);await expect(page.locator('#model-connection-status')).toContainText('каталог модели доступен');await page.locator('#generate').click();await expect(page.locator('#gen-title')).toHaveText('Не получилось создать игру',{timeout:20000});}
    if(scenario==='success'||scenario==='repair'){
      // The real server-side checker is included in the synthetic job
      // budget above. Keep the browser assertion bounded separately.
      await expect(page.locator('#message')).toContainText(/Игра (сохранена|готова)/,{timeout:16000});await expect(page.locator('#provenance')).toContainText('Ollama Cloud');
      const game=page.frameLocator('#game iframe');const canvas=game.locator('canvas');await canvas.click();const before=await canvas.evaluate(c=>(c as HTMLCanvasElement).toDataURL());await canvas.click();expect(await canvas.evaluate(c=>(c as HTMLCanvasElement).toDataURL())).not.toBe(before);
      expect(calls).toBe(scenario==='repair'?2:1);
    } else {
      await expect(page.locator('#gen-result')).toContainText({unsafe:'проверку безопасности', 'http-error':'LLM вернула ошибку',timeout:'не ответила вовремя',unavailable:/Не удалось подключиться (?:к модели|через прокси)/}[scenario]);
      expect((await(await page.request.get(server.url+'/api/games')).json()).games).toHaveLength(0);expect(calls).toBe(scenario==='unsafe'?2:scenario==='unavailable'?0:1);
    }
  } finally {await server.stop();server.cleanup();mock.closeAllConnections();await new Promise<void>(done=>mock.close(()=>done()));}
});

function synthetic(upstream:string):NodeJS.ProcessEnv{return{LIVE_PROVIDER:'ollama-cloud',OLLAMA_CLOUD_API_KEY:'synthetic-not-a-secret',CLOUD_API_KEY:'',CLOUD_BASE_URL:'',LLM_NETWORK_MODE:'direct',TELEGRAM_UPDATES:'off',TELEGRAM_BOT_TOKEN:'',NODE_OPTIONS:'--import='+pathToFileURL(resolve('tests/synthetic-cloud.mjs')).href,YAPLIX_TEST_UPSTREAM:upstream};}
