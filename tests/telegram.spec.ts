import {test,expect} from '@playwright/test';
import {createApp} from '../src/api.ts';
import {Store} from '../src/store.ts';
import {TelegramSessions} from '../src/telegram.ts';
import {signedData} from './telegram-fixture.ts';
test.beforeEach(({},info)=>test.skip(!['chromium-320','webkit-390'].includes(info.project.name),'Telegram synthetic integration on small Chromium/WebKit; real Telegram client is a separate check.'));
for(const identity of ['allowed','tampered','forbidden'] as const)test('Telegram same frontend '+identity+' (synthetic SDK and HTTPS transport)',async({page,context})=>{
 const token='synthetic-test-bot-token',store=new Store(':memory:');let liveCalls=0;
 const app=createApp(store,{generate:async()=>{liveCalls++;throw Error('synthetic');}},undefined,{mode:'https',host:'127.0.0.1',port:3000,origin:'https://yaplix.test',key:'x'.repeat(40)},new TelegramSessions({TELEGRAM_BOT_TOKEN:token,TELEGRAM_ALLOWED_USER_IDS:'123456789'}));
 const raw=identity==='tampered'?signedData(token).replace('Synthetic','Tampered'):signedData(token,identity==='forbidden'?999:123456789);
 const requests:string[]=[],errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 await context.route('https://telegram.org/js/telegram-web-app.js',route=>route.fulfill({contentType:'application/javascript',body:`window.tgEvents={};window.tgReady=false;window.Telegram={WebApp:{initData:${JSON.stringify(raw)},themeParams:{bg_color:'#112233',text_color:'#ffffff',secondary_bg_color:'#223344'},viewportHeight:700,viewportStableHeight:700,safeAreaInset:{top:20,bottom:16},contentSafeAreaInset:{top:12,bottom:8},ready(){window.tgReady=true},expand(){},onEvent(n,f){window.tgEvents[n]=f},offEvent(n){delete window.tgEvents[n]},BackButton:{show(){},hide(){},onClick(f){window.tgBack=f},offClick(){window.tgBack=null}}}};`}));
 await context.route('https://yaplix.test/**',async route=>{const req=route.request(),response=await app.request(req.url(),{method:req.method(),headers:{...req.headers(),Host:'yaplix.test','X-Forwarded-Proto':'https'},...(req.postData()?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
 try{
  await page.goto('https://yaplix.test/telegram');await expect(page.locator('body')).toHaveAttribute('data-ready','true');
  if(identity!=='allowed'){
   await expect(page.locator('#message')).toContainText(identity==='forbidden'?'список доступа':'авторизация не принята');expect(store.list()).toHaveLength(0);expect(liveCalls).toBe(0);expect(requests.some(url=>url.endsWith('/api/games'))).toBe(false);return;
  }
  expect(await page.evaluate(()=>(window as any).tgReady)).toBe(true);expect(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--tg-safe-top'))).toBe('20px');
  await page.evaluate(()=>{const app=(window as any).Telegram.WebApp;app.viewportHeight=420;app.themeParams.bg_color='#334455';(window as any).tgEvents.viewportChanged();(window as any).tgEvents.themeChanged();});
  expect(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--app-height'))).toBe('420px');
  await context.clearCookies(); // Header session supports Telegram clients blocking third-party cookies.
  await page.locator('#generate').click();await expect(page.locator('#message')).toContainText('Игра сохранена');expect(store.list()).toHaveLength(1);
  const game=page.frameLocator('#game iframe');await game.getByRole('button',{name:'Старт',exact:true}).click();await game.getByRole('button',{name:'Вправо',exact:true}).click();await expect(game.locator('#score')).toHaveText('1');
  await page.locator('#share').click();await expect(page.locator('#share-url')).toBeVisible();const url=await page.locator('#share-url').inputValue();expect(new URL(url).pathname).toMatch(/^\/play\//);
  expect(await page.evaluate(()=>Object.keys(localStorage))).toEqual([]);expect(await page.evaluate(()=>document.documentElement.outerHTML)).not.toContain(raw);expect(errors).toEqual([]);expect(liveCalls).toBe(0);
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));expect(await page.evaluate(()=>Object.keys((window as any).tgEvents))).toEqual([]);
 }finally{store.close();}
});
test('ordinary browser does not load Telegram SDK or adapter',async({page})=>{
 const requests:string[]=[];page.on('request',r=>requests.push(r.url()));await page.goto('/');await expect(page.locator('body')).toHaveAttribute('data-ready','true');expect(requests.some(u=>u.includes('telegram'))).toBe(false);
});
