import {strictCanvas} from './strict-canvas-fixtures.ts';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createAndOpen} from './ui-jobs-helper.ts';
import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { lanAddresses } from '../src/network.ts';
import { productionServer } from './production-helper.ts';
import { html } from './helpers.ts';
import {spec} from './helpers.ts';

test.beforeEach(({},info)=>{test.skip(!['chromium-desktop','chromium-320','webkit-390'].includes(info.project.name),'Production coverage on desktop Chromium and small Chromium/WebKit. Other profiles run full runtime/mobile suites.');});

test('production HTTP disconnect cancels cloud body and stores no game',async()=>{
 let started!:()=>void,disconnected!:()=>void;const began=new Promise<void>(done=>started=done),ended=new Promise<void>(done=>disconnected=done);
 const upstream=createServer((_req,res)=>{res.on('close',disconnected);res.writeHead(200);res.write('{');started();});await new Promise<void>(done=>upstream.listen(0,'127.0.0.1',done));
 const server=await productionServer('127.0.0.1',synthetic('http://127.0.0.1:'+(upstream.address() as any).port));
 try{
  const controller=new AbortController();const pending=fetch(server.url+'/api/games',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({spec,mode:'live'}),signal:controller.signal});const rejected=expect(pending).rejects.toThrow(/abort/i);
  await Promise.race([began,new Promise<void>((_,reject)=>setTimeout(()=>reject(Error('UPSTREAM_NOT_STARTED')),5000).unref())]);controller.abort();await rejected;
  await Promise.race([ended,new Promise<void>((_,reject)=>setTimeout(()=>reject(Error('UPSTREAM_NOT_CANCELLED')),1500).unref())]);expect((await(await fetch(server.url+'/api/games')).json()).games).toEqual([]);
 }finally{await server.stop();server.cleanup();upstream.closeAllConnections();await new Promise<void>(done=>upstream.close(()=>done()));}
});

test('real production LAN: authentication, QR independent decode, relative API, gameplay, restart and changed port', async({page,context},info)=>{
  // Two server startups, QR decodes and full win/loss/restart flows share this
  // test. Windows run 38862850604 reached the last export assertion at 20s.
  test.setTimeout(process.platform==='win32'?45000:20000);
  const host=lanAddresses()[0]?.address;test.skip(!host,'No private IPv4 interface available on this runner.');
  const key=randomBytes(32).toString('base64url'),env={YAPLIX_MODE:'lan',YAPLIX_ACCESS_KEY:key};
  let server=await productionServer(host,env);const directory=server.directory;
  const errors:string[]=[],apiOrigins:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))apiOrigins.push(new URL(r.url()).origin);});
  const decode=async()=>{await page.locator('#system summary').click();await expect(page.locator('#system-info')).toContainText('API: ответ получен');await page.getByRole('button',{name:'Показать QR',exact:true}).click();await expect(page.locator('#qr-image')).toBeVisible();const png=PNG.sync.read(await page.locator('#qr-image').screenshot());const result=(jsQR as unknown as (data:Uint8ClampedArray,width:number,height:number)=>{data:string}|null)(new Uint8ClampedArray(png.data),png.width,png.height);expect(result).not.toBeNull();return result!.data;};
  try {
    expect((await page.request.get(server.url+'/api/connection/qr.svg')).status()).toBe(401);
    await page.goto(server.url);await page.locator('#access-key').fill('wrong');await page.getByRole('button',{name:'Войти',exact:true}).click();await expect(page.locator('#access-message')).toContainText('Ключ не принят');
    await page.locator('#access-key').fill(key);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.getByRole('button',{name:'Создать',exact:true}).click();await expect(page.locator('#generate')).toBeVisible();
    const decoded=await decode();expect(decoded).toBe(server.url+'/');expect(decoded).not.toContain(key);expect(new URL(decoded).search).toBe('');expect(new URL(decoded).hash).toBe('');
    await createAndOpen(page);await expect(page.locator('#message')).toContainText('Игра сохранена');
    const game=page.frameLocator('#game iframe');await game.getByRole('button',{name:'Старт',exact:true}).click();
    await game.getByRole('button',{name:'Вправо',exact:true}).click();await expect(game.locator('#score')).toHaveText('1');
    await game.getByRole('button',{name:'Влево',exact:true}).click();await game.getByRole('button',{name:'Вправо',exact:true}).click();await expect(game.locator('#score')).toHaveText('1');
    for(let i=0;i<2;i++)await game.getByRole('button',{name:'Вправо',exact:true}).click();await expect(game.locator('#status')).toHaveText('Победа');await expect(page.locator('#analytics')).toContainText('Победы: 1');
    await page.locator('#replay').click();await game.getByRole('button',{name:'Старт',exact:true}).click();await game.getByRole('button',{name:'Вниз',exact:true}).click();await expect(game.locator('#status')).toHaveText('Поражение');await expect(page.locator('#analytics')).toContainText('Поражения: 1');
    const exportPath=await page.locator('#export').getAttribute('href');const firstOrigin=server.url;
    expect(apiOrigins.every(origin=>origin===firstOrigin)).toBe(true);expect(errors).toEqual([]);
    await page.screenshot({path:info.outputPath('production-lan.png'),fullPage:true});
    await server.stop();server=await productionServer(host,env,directory);expect(server.url).not.toBe(firstOrigin);
    await context.clearCookies();await page.goto(server.url);await page.locator('#access-key').fill(key);await page.getByRole('button',{name:'Войти',exact:true}).click();
    expect(await decode()).toBe(server.url+'/');expect((await page.request.get(server.url+exportPath)).status()).toBe(200);
    await page.getByRole('button',{name:'Игры',exact:true}).click();await page.locator('#games button').first().click();await expect(page.locator('#analytics')).toContainText('Победы: 1');
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
  const server=await productionServer('127.0.0.1',{...synthetic(`http://127.0.0.1:${port}`),LLM_MAX_ATTEMPTS:scenario==='repair'||scenario==='unsafe'?'2':'1',LLM_AUTO_REPAIR:'1',LLM_REPAIRS:'1',LLM_TIMEOUT_MS:scenario==='timeout'?'1000':'180000',LLM_REQUEST_TIMEOUT_MS:scenario==='timeout'?'1000':'60000'});
  try {
    await page.goto(server.url);await page.getByRole('button',{name:'Создать',exact:true}).click();if(scenario==='success'||scenario==='repair')await createAndOpen(page,'Создать игру',false);else {await page.locator('#generate').click();await page.locator('#jobs-toggle').click();}
    if(scenario==='success'||scenario==='repair'){
      // The real server-side checker is included in the 15-second generation
      // deadline above. Wait for that contract, rather than a five-second poll.
      await expect(page.locator('#message')).toContainText('Игра сохранена',{timeout:16000});await expect(page.locator('#provenance')).toContainText('Ollama Cloud');
      const game=page.frameLocator('#game iframe');const canvas=game.locator('canvas');await canvas.tap();const before=await canvas.evaluate(c=>(c as HTMLCanvasElement).toDataURL());await canvas.tap();expect(await canvas.evaluate(c=>(c as HTMLCanvasElement).toDataURL())).not.toBe(before);
      expect(calls).toBe(scenario==='repair'?2:1);
    } else {
      await expect(page.locator('#jobs-list')).toContainText({unsafe:'проверку безопасности', 'http-error':'LLM вернула ошибку',timeout:'не ответила вовремя',unavailable:'Не удалось подключиться к модели'}[scenario]);
      await expect(page.locator('#generate')).toBeEnabled();expect((await(await page.request.get(server.url+'/api/games')).json()).games).toHaveLength(0);expect(calls).toBe(scenario==='unsafe'?2:scenario==='unavailable'?0:1);
    }
  } finally {await server.stop();server.cleanup();mock.closeAllConnections();await new Promise<void>(done=>mock.close(()=>done()));}
});

function synthetic(upstream:string):NodeJS.ProcessEnv{return{LIVE_PROVIDER:'ollama-cloud',OLLAMA_CLOUD_API_KEY:'synthetic-not-a-secret',CLOUD_API_KEY:'',CLOUD_BASE_URL:'',LLM_NETWORK_MODE:'direct',TELEGRAM_UPDATES:'off',TELEGRAM_BOT_TOKEN:'',NODE_OPTIONS:'--import='+pathToFileURL(resolve('tests/synthetic-cloud.mjs')).href,YAPLIX_TEST_UPSTREAM:upstream};}
