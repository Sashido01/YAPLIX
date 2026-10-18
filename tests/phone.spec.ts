import { test, expect } from '@playwright/test';
import { serve } from '@hono/node-server';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { PhoneConnection } from '../src/phone.ts';
import { Store } from '../src/store.ts';
import { createApp } from '../src/api.ts';
import { lanAddresses } from '../src/network.ts';
import { artifact, spec } from './helpers.ts';
import { GenerationJobs } from '../src/jobs.ts';

test('one click QR decodes to actual selected game; isolated phone touch, rotation, restart, reopen and revoke',async({page,browser,isMobile},info)=>{
  test.setTimeout(35000);
  const host=lanAddresses()[0]?.address;test.skip(!host,'No private IPv4 on runner');
  const store=new Store(':memory:'),version=store.save(spec,artifact);
  const other=store.save({...spec,prompt:'Another private game'},artifact);
  // Synthetic adapter inventory; a real bound server, HTTP, QR and browser.
  const phone=new PhoneConnection(store,async()=>[{name:'WiFi test',address:host}],Date.now,undefined,0);
  const jobs=new GenerationJobs(store,undefined,undefined,false);
  const app=createApp(store,undefined,undefined,undefined,undefined,undefined,jobs,phone);
  const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0});await new Promise<void>(r=>server.once('listening',r));
  const url='http://127.0.0.1:'+(server.address() as {port:number}).port;
  const guest=await browser.newContext({...info.project.use,baseURL:undefined});
  const mobile=await guest.newPage(),errors:string[]=[];mobile.on('pageerror',e=>errors.push(e.message));
  try{
    await page.clock.install({time:new Date()});await mobile.clock.install({time:new Date()});
    await page.goto(url+'/?game='+version.gameId);
    await expect(page.locator('#game iframe')).toHaveCount(1);
    await page.locator('#phone summary').first().click();
    await expect(page.locator('#phone-qr')).toBeVisible();
    const png=PNG.sync.read(await page.locator('#phone-qr').screenshot());
    const decoded=(jsQR as unknown as (data:Uint8ClampedArray,w:number,h:number)=>{data:string}|null)(new Uint8ClampedArray(png.data),png.width,png.height);
    expect(decoded).not.toBeNull();const target=decoded!.data;
    expect(target).toBe((await(await page.request.get(url+'/api/phone')).json()).url);
    expect(new URL(target).search).toBe('');expect(new URL(target).pathname).toBe('/phone');
    const received:string[]=[];mobile.on('request',r=>received.push(r.url()));
    await mobile.goto(target);const frame=mobile.frameLocator('#game iframe');
    await expect(frame.locator('#start')).toBeVisible();expect(new URL(mobile.url()).hash).toBe('');
    const action=async(selector:string)=>isMobile?frame.locator(selector).tap():frame.locator(selector).click();
    await action('#start');await action('#point');await expect(frame.locator('#score')).toHaveText('1');
    const original=mobile.viewportSize()!;
    for(const size of [{width:original.height,height:original.width},original,{width:original.width,height:350}]){
      await mobile.setViewportSize(size);expect(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(frame.locator('#score')).toHaveText('1');
    }
    await mobile.setViewportSize(original);await mobile.getByRole('button',{name:'Запустить заново',exact:true}).click();
    await expect(frame.locator('#start')).toBeVisible();await action('#start');await action('#point');await expect(frame.locator('#score')).toHaveText('1');
    await mobile.reload();await expect(frame.locator('#start')).toBeVisible();expect(await mobile.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts');
    await mobile.goto(new URL(target).origin+'/phone/style.css');await mobile.goBack();await expect(frame.locator('#start')).toBeVisible();
    expect(received.every(value=>!value.includes(new URL(target).hash.slice(1)))).toBe(true);
    expect((await mobile.request.get(new URL(target).origin+'/api/games')).status()).toBe(401);
    expect((await mobile.request.post(new URL(target).origin+'/api/jobs',{data:{}})).status()).toBe(401);
    await mobile.screenshot({path:info.outputPath('phone-game.png')});
    await page.getByRole('button',{name:'Игры',exact:true}).click();await page.locator('#games button[data-version="'+other.versionId+'"]').click();
    await page.locator('#phone details summary').click();await page.getByRole('button',{name:'Обновить список сетей и статус',exact:true}).click();
    await expect.poll(async()=>await page.locator('#phone-url').inputValue()).not.toBe(target);
    const fresh=await page.locator('#phone-url').inputValue();expect(new URL(fresh).port).toBe(new URL(target).port);expect(new URL(fresh).hash).not.toBe(new URL(target).hash);await mobile.goto(fresh);await expect(frame.locator('#start')).toBeVisible();
    expect((await(await page.request.get(url+'/api/phone')).json()).versionId).toBe(other.versionId);await expect(page.locator('#phone-version')).toHaveValue(other.versionId);
    await mobile.clock.fastForward(31*60_000);await expect(mobile.locator('iframe')).toHaveCount(0);await expect(mobile.locator('#restart')).toBeDisabled();await expect(mobile.locator('#status')).toContainText('доступ истёк');
    await page.clock.fastForward(31*60_000);await expect(page.locator('#phone-ready')).toBeHidden();
    await page.getByRole('button',{name:'Отключить доступ',exact:true}).click();await expect(page.locator('#phone-ready')).toBeHidden();
    await expect(mobile.request.get(new URL(fresh).origin+'/phone/version')).rejects.toThrow();
    expect(store.getVersion(version.versionId).html).toBe(artifact.html);expect(store.analytics(version.versionId).sessionCount).toBe(1); // owner's desktop session only
    expect(errors).toEqual([]);
  }finally{await guest.close();await phone.close();if('closeAllConnections' in server)server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await jobs.close();store.close();}
});

test('phone errors and multiple networks show a choice without a ready QR; LIVE catalogue failure explains its source',async({page})=>{
  let chosen:unknown;
  let release!:()=>void;const pending=new Promise<void>(done=>release=done);
  await page.route('**/api/games',route=>route.fulfill({json:{games:[{versionId:'00000000-0000-4000-8000-000000000000',spec}]}}));
  await page.route('**/api/phone',async route=>{if(route.request().method()==='POST'){chosen=route.request().postDataJSON();await pending;return route.fulfill({status:503,json:{error:'PHONE_SERVER_UNREACHABLE'}});}return route.fulfill({json:{enabled:false,networks:[{name:'WiFi',address:'192.168.1.2'},{name:'Ethernet',address:'10.0.0.2'}]}});});
  await page.goto('/');await page.locator('#phone summary').first().click();
  await expect(page.locator('#phone-status')).toContainText('Выберите сеть');await expect(page.locator('#phone-ready')).toBeHidden();await expect(page.locator('#phone-network-label')).toBeVisible();
  await page.locator('#phone-network').selectOption('10.0.0.2');await expect(page.locator('#phone-network')).toBeDisabled();await expect(page.locator('#phone-version')).toBeDisabled();release();await expect(page.locator('#phone-status')).toContainText('Не удалось открыть страницу');expect(chosen).toEqual({versionId:'00000000-0000-4000-8000-000000000000',address:'10.0.0.2'});await expect(page.locator('#phone-ready')).toBeHidden();
  await page.route('**/api/diagnostics',route=>route.fulfill({json:{ok:true,liveConfigured:true,llmState:'unreachable',mode:'local',model:'gemma4:31b',readinessSource:'models-api-get',readinessCheckedAt:'2026-10-16T10:00:00Z',network:{category:'LLM_RESPONSE_TIMEOUT'},lastSavedGeneration:{createdAt:'2026-10-16T09:00:00Z',model:'gemma4:31b'}}}));
  await page.locator('#system summary').click();
  await expect(page.locator('#system-info')).toContainText('доступность генерации не определена');await expect(page.locator('#system-info')).toContainText('models-api-get');await expect(page.locator('#system-info')).toContainText('история версий');await expect(page.locator('#system-info')).toContainText('Сервер на этом компьютере');
  await page.route('**/api/phone',route=>route.abort());await page.getByRole('button',{name:'Обновить подключение',exact:true}).click();await expect(page.locator('#phone-ready')).toBeHidden();
});


test('occupied phone port explains the fixed-port conflict without extra launch steps',async({page})=>{
  await page.route('**/api/games',route=>route.fulfill({json:{games:[{versionId:'00000000-0000-4000-8000-000000000000',spec}]}}));
  await page.route('**/api/phone',route=>route.request().method()==='POST'
    ?route.fulfill({status:503,json:{error:'PORT_IN_USE'}})
    :route.fulfill({json:{enabled:false,networks:[{name:'WiFi',address:'192.168.1.2'}]}}));
  await page.goto('/');await page.locator('#phone summary').first().click();
  await expect(page.locator('#phone-status')).toContainText('Порт подключения телефона занят');
  await expect(page.locator('#phone-ready')).toBeHidden();
});
