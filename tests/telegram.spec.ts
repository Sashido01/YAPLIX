import {test,expect} from '@playwright/test';
import {createApp} from '../src/api.ts';
import {Store} from '../src/store.ts';
import {TelegramSessions} from '../src/telegram.ts';
import {GenerationEngine} from '../src/live.ts';
import {html} from './helpers.ts';
import {signedData} from './telegram-fixture.ts';
test.beforeEach(({},info)=>test.skip(!['chromium-320','webkit-390'].includes(info.project.name),'Telegram synthetic integration on small Chromium/WebKit; real Telegram client is a separate check.'));
for(const identity of ['allowed','tampered','forbidden'] as const)test('Telegram same frontend '+identity+' (synthetic SDK and HTTPS transport)',async({page,context})=>{
 const token='synthetic-test-bot-token',store=new Store(':memory:');let syntheticCalls=0,tgSession:string|undefined;
 const engine=new GenerationEngine([{route:'primary',provider:'ollama.com',model:'gemma4:31b',readiness:async()=>'ready',complete:async()=>{syntheticCalls++;return{code:html,model:'gemma4:31b'};}}],{repairs:0,check:async()=>({rendering:{contract:'canvas-webgl-strict-v2',contexts:['2d'],profiles:[320,390,844]},profiles:[320,390,844],offline:true,errors:0,scope:'full-html'})});
 const app=createApp(store,engine,undefined,{mode:'https',host:'127.0.0.1',port:3000,origin:'https://yaplix.test',key:'x'.repeat(40)},new TelegramSessions({TELEGRAM_BOT_TOKEN:token,TELEGRAM_ALLOWED_USER_IDS:'123456789'}));
 const raw=identity==='tampered'?signedData(token).replace('Synthetic','Tampered'):signedData(token,identity==='forbidden'?999:123456789);
 const requests:string[]=[],errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 await context.route('https://telegram.org/js/telegram-web-app.js',route=>route.fulfill({contentType:'application/javascript',body:`window.tgEvents={};window.tgReady=false;window.Telegram={WebApp:{initData:${JSON.stringify(raw)},themeParams:{bg_color:'#112233',text_color:'#ffffff',secondary_bg_color:'#223344'},viewportHeight:700,viewportStableHeight:700,safeAreaInset:{top:20,bottom:16},contentSafeAreaInset:{top:12,bottom:8},ready(){window.tgReady=true},expand(){},onEvent(n,f){window.tgEvents[n]=f},offEvent(n){delete window.tgEvents[n]},BackButton:{show(){},hide(){},onClick(f){window.tgBack=f},offClick(){window.tgBack=null}}}};`}));
 await context.route('https://yaplix.test/**',async route=>{const req=route.request(),response=await app.request(req.url(),{method:req.method(),headers:{...req.headers(),Host:'yaplix.test','X-Forwarded-Proto':'https'},...(req.postData()?{body:req.postData()!}:{})});if(new URL(req.url()).pathname==='/api/telegram/auth'&&response.ok)tgSession=(await response.clone().json() as {sessionToken:string}).sessionToken;await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
 try{
  await page.goto('https://yaplix.test/telegram');await expect(page.locator('body')).toHaveAttribute('data-ready','true');
  if(identity!=='allowed'){
   await expect(page.locator('#message')).toContainText(identity==='forbidden'?'список доступа':'авторизация не принята');expect(store.list()).toHaveLength(0);expect(syntheticCalls).toBe(0);expect(requests.some(url=>url.endsWith('/api/games'))).toBe(false);return;
  }
  expect(await page.evaluate(()=>(window as any).tgReady)).toBe(true);expect(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--tg-safe-top'))).toBe('20px');
  await page.evaluate(()=>{const app=(window as any).Telegram.WebApp;app.viewportHeight=420;app.themeParams.bg_color='#334455';(window as any).tgEvents.viewportChanged();(window as any).tgEvents.themeChanged();});
  expect(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--app-height'))).toBe('420px');
  await context.clearCookies(); // Header session supports Telegram clients blocking third-party cookies.
  await page.getByRole('button',{name:'Создать',exact:true}).click();await page.locator('#prompt').fill('Синтетическая тестовая игра');
  const posted=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/jobs'&&r.request().method()==='POST');await page.getByRole('button',{name:'Создать игру',exact:true}).click();const job=await(await posted).json();expect(job.jobId).toBeTruthy();
  await expect.poll(()=>store.list().length,{timeout:18000}).toBe(1);await expect(page.locator('#game iframe')).toBeVisible({timeout:18000});expect(store.list()[0].model).toBe('gemma4:31b');
  const game=page.frameLocator('#game iframe');await game.getByRole('button',{name:'Start',exact:true}).click();await game.getByRole('button',{name:'Point',exact:true}).click();await expect(game.locator('#score')).toHaveText('1');
  await page.locator('#share').click();await expect(page.locator('#share-url')).toBeVisible();const url=await page.locator('#share-url').inputValue();expect(new URL(url).pathname).toMatch(/^\/play\//);
  const diagnostics=await page.evaluate(async({jobId,session})=>{const response=await fetch('/api/jobs/'+jobId+'/diagnostics',{headers:{'X-Yaplix-Telegram-Session':session!}});return{status:response.status,body:await response.json()};},{jobId:job.jobId,session:tgSession});expect(tgSession).toMatch(/^[0-9a-f]{64}$/);expect(diagnostics.status).toBe(200);expect(diagnostics.body).toHaveProperty('events');
  expect(await page.evaluate(()=>Object.keys(localStorage))).toEqual(['yaplix-model-trace-id']);expect(await page.evaluate(()=>document.documentElement.outerHTML)).not.toContain(raw);expect(errors).toEqual([]);expect(syntheticCalls).toBe(1);
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));expect(await page.evaluate(()=>Object.keys((window as any).tgEvents))).toEqual([]);
 }finally{store.close();}
});
test('ordinary browser does not load Telegram SDK or adapter',async({page})=>{
 const requests:string[]=[];page.on('request',r=>requests.push(r.url()));await page.goto('/');await expect(page.locator('body')).toHaveAttribute('data-ready','true');expect(requests.some(u=>u.includes('telegram'))).toBe(false);
});
