import {strictCanvas} from './strict-canvas-fixtures.ts';
import {test,expect} from '@playwright/test';
import {createAndOpen} from './ui-jobs-helper.ts';
import {spec,html,artifact} from './helpers.ts';
import {Store} from '../src/store.ts';
import {createApp} from '../src/api.ts';
import {GenerationEngine} from '../src/live.ts';

import {GenerationJobs} from '../src/jobs.ts';
import {Fault} from '../src/contracts.ts';
import {prepareSyntheticProviderUI} from './ui-jobs-helper.ts';

async function openCompletedJobToast(page:import('@playwright/test').Page,button:string){
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/jobs'&&r.request().method()==='POST');
 await page.getByRole('button',{name:button,exact:true}).click();const job=await(await response).json();
 await expect.poll(async()=>page.evaluate(async id=>(await(await fetch('/api/jobs/'+id)).json()).stage,job.jobId),{timeout:18000}).toBe('completed');
 const saved=await page.evaluate(async id=>await(await fetch('/api/jobs/'+id)).json(),job.jobId);
 const exportHref=`/api/versions/${saved.versionId}/export`;
 if(await page.locator('#export').getAttribute('href')!==exportHref){await expect.poll(async()=>await page.locator('#export').getAttribute('href')===exportHref||((await page.locator('#job-toast-text').textContent())??'').includes(saved.spec.prompt.slice(0,60)),{timeout:18000}).toBe(true);if(await page.locator('#export').getAttribute('href')!==exportHref)await page.locator('#job-toast-open').click();}
 await expect(page.locator('#export')).toHaveAttribute('href',exportHref,{timeout:10000});await expect(page.locator('#versions')).toBeEnabled({timeout:10000});await expect(page.locator('#game iframe')).toBeVisible({timeout:10000});return saved;
}

const touchRepairInstruction='Исправь сенсорное управление змейкой. Сейчас четыре touch-зоны имеют нулевую высоту: координата y равна canvas.width, а высота вычисляется как canvas.height минус y. Исправь геометрию так, чтобы зоны имели реальную площадь и работали на телефонах. Можно использовать крупные экранные кнопки внутри Canvas или управление свайпами. Сохрани рабочее управление стрелками клавиатуры, экран начала, сбор еды, счёт, постепенное ускорение, столкновения и Restart. Обеспечь адаптацию к портретной и альбомной ориентации. Весь видимый игровой интерфейс должен находиться внутри Canvas. Верни полный автономный HTML со встроенными CSS и JavaScript';

test('saved recoverable job reopens in the workspace and continues locally after reload',async({page,context,baseURL})=>{
 test.setTimeout(30000);const store=new Store(':memory:');let calls=0,checks=0;
 const engine=new GenerationEngine([{route:'primary',provider:'ollama.com',model:'gemma4:31b',readiness:async()=>'ready',complete:async()=>{calls++;return{code:strictCanvas(),model:'gemma4:31b'};}}],{allowLlmRepair:true,repairs:1,check:async()=>{if(++checks===1)throw new Fault('BROWSER_CANVAS_RENDER_UNVERIFIED',502);return{rendering:{contract:'canvas-webgl-strict-v2',contexts:['2d'],profiles:[320,390,844]},profiles:[320,390,844],offline:true,errors:0,scope:'full-html'};}});
 const jobs=new GenerationJobs(store,engine,undefined,true,{maxCalls:2,automaticRetries:false});const app=createApp(store,engine,undefined,undefined,undefined,undefined,jobs);
 await context.route(baseURL+'/**',async route=>{const req=route.request(),response=await app.request(req.url(),{method:req.method(),headers:{...req.headers(),'accept-encoding':'identity'},...(req.postData()?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
 try{
  await page.goto('/');await expect(page.locator('body')).toHaveAttribute('data-ready','true');await page.locator('#prompt').fill('Saved checkpoint recovery');await page.locator('#generate').click();
  await expect(page.locator('#gen-stage')).toContainText('Нужно действие пользователя',{timeout:10000});expect(calls).toBe(1);
  await page.reload();await expect(page.locator('#gen-continue')).toBeVisible({timeout:5000});await page.locator('#gen-continue').click();
  await expect.poll(()=>jobs.list('owner')[0]?.stage,{timeout:10000}).toBe('completed');await expect(page.locator('#game iframe')).toBeVisible();expect(calls).toBe(1);expect(jobs.list('owner')[0].attempts).toBe(1);
  const recovered=jobs.list('owner')[0];
  await expect(page.locator('#versions')).toHaveValue(recovered.versionId!);
  await expect(page.locator('#edit-game')).toBeEnabled();
  await page.locator('#edit-game').click();
  await page.locator('#change').fill('Synthetic edit after recovery');
  await expect(page.locator('#improve')).toBeEnabled();
 }finally{await jobs.close();store.close();}
});

test('unverified Canvas input offers a sandboxed draft preview without another provider request',async({page,context,baseURL})=>{
 test.setTimeout(30000);const store=new Store(':memory:');let calls=0;
 const engine=new GenerationEngine([{route:'primary',provider:'ollama.com',model:'gemma4:31b',readiness:async()=>'ready',complete:async()=>{calls++;return{code:html,model:'gemma4:31b'};}}],{allowLlmRepair:false,check:async()=>{throw new Fault('BROWSER_CANVAS_ACTIVITY_UNVERIFIED',502);}});
 const jobs=new GenerationJobs(store,engine,undefined,true,{maxCalls:2,automaticRetries:false}),app=createApp(store,engine,undefined,undefined,undefined,undefined,jobs);
 await context.route(baseURL+'/**',async route=>{const req=route.request(),response=await app.request(req.url(),{method:req.method(),headers:{...req.headers(),'accept-encoding':'identity'},...(req.postData()?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
 try{
  await page.goto('/');await page.locator('#prompt').fill('Canvas input proof is incomplete');await page.locator('#generate').click();
  await expect.poll(()=>jobs.list('owner')[0]?.stage,{timeout:10000}).toBe('needs_attention');
  const preview=page.locator('#gen-preview');await expect(preview).toBeVisible();await expect(preview).toHaveAttribute('href',/\/api\/jobs\/.+\/preview/);
  const popupPromise=page.waitForEvent('popup');await preview.click();const popup=await popupPromise;await expect(popup).toHaveTitle('Synthetic test game');
  expect(popup.url()).toContain('/api/jobs/');expect(calls).toBe(1);expect(jobs.list('owner')[0].validation).toMatchObject({level:'NOT_VERIFIED',code:'BROWSER_CANVAS_ACTIVITY_UNVERIFIED'});expect(store.list()).toHaveLength(0);
  await popup.close();
 }finally{await jobs.close();store.close();}
});

test('saved game editor stays available while nonessential post-open diagnostics are pending',async({page,context,baseURL})=>{
 const store=new Store(':memory:');const saved=store.save(spec,artifact);let release!:()=>void,started!:()=>void;
 const pending=new Promise<void>(done=>release=done),seen=new Promise<void>(done=>started=done);
 const engine=new GenerationEngine([{route:'primary',provider:'ollama.com',model:'gemma4:31b',readiness:async()=>'ready',complete:async()=>{throw new Error('This UI-only regression must not dispatch.');}}]);
 const jobs=new GenerationJobs(store,engine);const app=createApp(store,engine,undefined,undefined,undefined,undefined,jobs);
 await context.route(baseURL+'/**',async route=>{const req=route.request(),url=new URL(req.url());if(url.pathname.endsWith('/analytics')){started();await pending;}const response=await app.request(req.url(),{method:req.method(),headers:{...req.headers(),'accept-encoding':'identity'},...(req.postData()?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
 try{
  await page.goto('/?game='+saved.gameId+'&version='+saved.versionId);await expect(page.locator('#game iframe')).toBeVisible();await seen;
  await expect(page.locator('#versions')).toHaveValue(saved.versionId);await page.locator('#edit-game').click();await page.locator('#change').fill('Synthetic edit');
  await expect(page.locator('#improve')).toBeEnabled();
 }finally{release();await jobs.close();store.close();}
});

test('saved-game edit sends one complete-source job, preserves the parent, and traces editor state',async({page,context,baseURL})=>{
 test.setTimeout(30000);const store=new Store(':memory:');const original=store.save(spec,artifact),originalHtml=original.html;const messages:any[]=[];let posts=0,rejectNext=false,release!:()=>void,started!:()=>void;
 const pending=new Promise<void>(done=>release=done),seen=new Promise<void>(done=>started=done);
 const engine=new GenerationEngine([{route:'primary',provider:'ollama.com',model:'gemma4:31b',readiness:async()=>'ready',complete:async m=>{messages.push(structuredClone(m));return{code:html,model:'gemma4:31b'};}}],{repairs:0,check:async()=>({profiles:[320,390,844],offline:true,errors:0,scope:'full-html',rendering:{contract:'canvas-webgl-strict-v2',contexts:['2d'],profiles:[320,390,844]}})});
 const jobs=new GenerationJobs(store,engine,undefined,true,{maxCalls:1,automaticRetries:false}),app=createApp(store,engine,undefined,undefined,undefined,undefined,jobs);
 await context.route(baseURL+'/**',async route=>{const req=route.request(),url=new URL(req.url());if(url.pathname.endsWith('/analytics')){started();await pending;}if(url.pathname==='/api/jobs'&&req.method()==='POST'){posts++;if(rejectNext){rejectNext=false;await route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({error:'JOB_QUEUE_FULL'})});return;}}const response=await app.request(req.url(),{method:req.method(),headers:{...req.headers(),'accept-encoding':'identity'},...(req.postData()?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
 try{
  await page.goto('/?game='+original.gameId+'&version='+original.versionId);await expect(page.locator('#game iframe')).toBeVisible();await seen;
  await expect(page.locator('#versions')).toHaveValue(original.versionId);await page.locator('#edit-game').click();await page.locator('#change').fill(touchRepairInstruction);await expect(page.locator('#improve')).toBeEnabled();
  expect((await app.request('/api/providers')).status).toBe(200);release();
  const created=page.waitForRequest(req=>new URL(req.url()).pathname==='/api/jobs'&&req.method()==='POST');await page.locator('#improve').click();const request=await created;const payload=JSON.parse(request.postData()!);
  expect(payload.previousVersionId).toBe(original.versionId);expect(payload.providerMode).toBe('ollama-cloud');expect(payload.spec.prompt).toBe(touchRepairInstruction);
  await expect.poll(()=>jobs.list('owner')[0]?.stage,{timeout:10000}).toBe('completed');const edited=jobs.list('owner')[0];expect(posts).toBe(1);expect(messages).toHaveLength(1);expect(messages[0][1].content).toContain(originalHtml);
  expect(store.getVersion(original.versionId).html).toBe(originalHtml);expect(store.history(original.gameId)).toHaveLength(2);expect(new URL(page.url()).searchParams.get('version')).toBe(original.versionId);
  await page.locator('#job-toast-open').click();await expect.poll(()=>new URL(page.url()).searchParams.get('version'),{timeout:5000}).toBe(edited.versionId);
  await expect(page.locator('#improve')).toBeEnabled();await expect.poll(()=>jobs.report('owner',edited.jobId).events.some((row:any)=>row.event==='ui.editor_state'&&row.details?.versionId===edited.versionId&&row.details?.reasonCode?.startsWith('READY')),{timeout:5000}).toBe(true);
  await page.reload();await expect(page.locator('#versions')).toHaveValue(edited.versionId!);expect(posts).toBe(1);expect(store.getVersion(original.versionId).html).toBe(originalHtml);
  await page.locator('#edit-game').click();await page.locator('#change').fill('A second synthetic edit that the queue will reject');rejectNext=true;await page.locator('#improve').click();
  await expect(page.locator('#message')).toContainText('Очередь заполнена');expect(posts).toBe(2);expect(messages).toHaveLength(1);
  await expect.poll(()=>jobs.report('owner',edited.jobId).events.some((row:any)=>row.event==='ui.api_error'&&row.details?.reasonCode==='JOB_QUEUE_FULL'),{timeout:5000}).toBe(true);
  const editedHtml=store.getVersion(edited.versionId!).html;expect(editedHtml).not.toBe(originalHtml);
  await page.reload();expect(posts).toBe(2);expect(store.getVersion(original.versionId).html).toBe(originalHtml);expect(store.getVersion(edited.versionId!).html).toBe(editedHtml);
 }finally{release();await jobs.close();store.close();}
});

test('second creation restores Create availability while the prior game stays open',async({page,context,baseURL})=>{
 const store=new Store(':memory:');
 const engine=new GenerationEngine([{route:'primary',provider:'ollama.com',model:'gemma4:31b',readiness:async()=>'ready',complete:async()=>({code:html,model:'gemma4:31b'})}],{repairs:0,check:async()=>({profiles:[320,390,844],offline:true,errors:0,scope:'full-html',rendering:{contract:'canvas-webgl-strict-v2',contexts:['2d'],profiles:[320,390,844]}})});
 const jobs=new GenerationJobs(store,engine),app=createApp(store,engine,undefined,undefined,undefined,undefined,jobs);
 await context.route(baseURL+'/**',async route=>{const req=route.request(),response=await app.request(req.url(),{method:req.method(),headers:{...req.headers(),'accept-encoding':'identity'},...(req.postData()?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
 try{
  await page.goto('/');await createAndOpen(page,'Создать игру',false);
  const first=await page.locator('#versions').inputValue();
  await page.locator('#prompt').fill('A second independent game');await page.locator('#generate').click();
  await expect.poll(()=>jobs.list('owner').filter(j=>j.stage==='completed').length).toBe(2);
  await expect(page.locator('#generate')).toBeEnabled();
  expect(await page.locator('#versions').inputValue()).toBe(first);
 }finally{await jobs.close();store.close();}
});

test('MICRO-023 create, edit with Ollama, old version, reopen and export (mocked inference)',async({page,context,baseURL},info)=>{
 test.setTimeout(30000);
 const store=new Store(':memory:');const messages:any[]=[];
 const engine=new GenerationEngine([{route:'primary',provider:'ollama.com',model:'gemma4:31b',readiness:async()=>'ready',complete:async m=>{messages.push(structuredClone(m));return{code:messages.length===1?html:html.replace('Synthetic test game','Edited game'),model:'gemma4:31b'};}}],{repairs:0,check:async()=>({profiles:[320,390,844],offline:true,errors:0,scope:'full-html',rendering:{contract:'canvas-webgl-strict-v2',contexts:['2d'],profiles:[320,390,844]}})});
 const jobs=new GenerationJobs(store,engine),app=createApp(store,engine,undefined,undefined,undefined,undefined,jobs);
 await context.route(baseURL+'/**',async route=>{const req=route.request(),response=await app.request(req.url(),{method:req.method(),headers:{...req.headers(),'accept-encoding':'identity'},...(req.postData()?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
 try{
  await page.goto('/');await page.getByRole('button',{name:'Создать',exact:true}).click();await expect(page.locator('#provider-mode')).toHaveValue('ollama-cloud');await expect(page.locator('#mode')).toHaveCount(0);
  await createAndOpen(page,'Создать игру',false);const first=store.getVersion(store.list()[0].versionId);await expect(page.locator('#provenance')).toContainText('механика не проверена');await expect(page.locator('#provenance')).not.toContainText('gameplay проверен частично');
  await expect(page.locator('#edit-provider-mode')).toHaveValue('ollama-cloud');
  expect(await page.locator('#edit-provider-mode option').evaluateAll(nodes=>nodes.map(n=>(n as HTMLOptionElement).value))).toEqual(['ollama-cloud','openrouter','chatgpt']);
  await page.locator('#edit-game').click();
  await page.locator('#change').fill('Add enemies and preserve existing controls');await openCompletedJobToast(page,'Создать следующую версию');
  expect(messages).toHaveLength(2);expect(messages[1][1].content).toContain(first.html);expect(messages[1][1].content).toContain('Add enemies');
  const history=store.history(first.gameId);expect(history).toHaveLength(2);const second=history[1];
  await page.reload();await page.locator('#create-more > summary').click();await expect(page.locator('#versions')).toBeEnabled();
  await page.locator('#versions').selectOption(first.versionId);await expect(page.locator('#export')).toHaveAttribute('href','/api/versions/'+first.versionId+'/export');
  await page.reload();await page.locator('#create-more > summary').click();await expect(page.locator('#versions')).toHaveValue(first.versionId);await page.locator('#versions').selectOption(second.versionId);
  const game=page.frameLocator('#game iframe');await game.getByRole('button',{name:'Start',exact:true}).click();await game.getByRole('button',{name:'Point',exact:true}).click();await expect(game.locator('#score')).toHaveText('1');
  const exported=await app.request('/api/versions/'+second.versionId+'/export');expect(await exported.text()).toBe(store.getVersion(second.versionId).html);
  expect(await page.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts');expect(store.getVersion(first.versionId).html).toBe(first.html);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(info.project.name==='chromium-390')await page.screenshot({path:'.local/micro023/edit-mobile.png',fullPage:true});
 }finally{await jobs.close();store.close();}
});

test('Full HTML UI exposes two manual provider modes and restores the selected mode and idea',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Создать',exact:true}).click();
  await page.locator('#create details summary').click();

  await expect(page.locator('#mode')).toHaveCount(0);expect(await page.locator('#provider-mode option').evaluateAll(options=>options.map(o=>(o as HTMLOptionElement).value))).toEqual(['ollama-cloud','openrouter','chatgpt']);
  await page.locator('#provider-mode').selectOption('openrouter');await page.locator('#prompt').fill('Собери игру три в ряд');
  await page.reload();await page.getByRole('button',{name:'Создать',exact:true}).click();
  await expect(page.locator('#provider-mode')).toHaveValue('openrouter');await expect(page.locator('#prompt')).toHaveValue('Собери игру три в ряд');
  const selector=await page.locator('#provider-mode').boundingBox();expect(selector!.x).toBeGreaterThanOrEqual(0);expect(selector!.width).toBeLessThanOrEqual(await page.evaluate(()=>innerWidth));
});
test('controlled LIVE worker runs while touch round continues; completed checked version never opens automatically',async({page,context,baseURL},info)=>{
  test.setTimeout(35000);
  test.skip(!['chromium-320','webkit-390'].includes(info.project.name),'Controlled LIVE worker on small Chromium/WebKit; other profiles run key-free background scenario.');
  const store=new Store(':memory:');let release!:()=>void;const held=new Promise<void>(done=>release=done);
  const engine=new GenerationEngine([{route:'primary',provider:'ollama.com',model:'fixture-model',readiness:async()=>'ready',complete:async()=>{await held;return{code:strictCanvas(),model:'actual-fixture-model'};}}],{timeoutMs:15000});
  const jobs=new GenerationJobs(store,engine),app=createApp(store,engine,undefined,undefined,undefined,undefined,jobs);const previous=store.save(spec,artifact);
  await context.route(baseURL+'/**',async route=>{const req=route.request(),response=await app.request(req.url(),{method:req.method(),headers:{...req.headers(),'accept-encoding':'identity'},...(req.postData()?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
  try{await page.goto('/?game='+previous.gameId);await expect(page.locator('body')).toHaveAttribute('data-ready','true');const game=page.frameLocator('#game iframe');await game.getByRole('button',{name:'Start',exact:true}).tap();await game.getByRole('button',{name:'Point',exact:true}).tap();const realm=await page.locator('iframe').elementHandle();await page.getByRole('button',{name:'Создать',exact:true}).click();await prepareSyntheticProviderUI(page);const createdResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/jobs'&&r.request().method()==='POST');
  await page.locator('#prompt').fill('Собери ещё одну короткую игру');await page.locator('#generate').click();const response=await createdResponse;
  expect(response.status(),await response.text()).toBe(202);const created=await response.json();
  expect(jobs.get('owner',created.jobId).providerMode).toBe('ollama-cloud');
  expect(jobs.list('owner').map(job=>job.jobId)).toContain(created.jobId);
  const listed=await app.request('/api/jobs');expect(listed.status).toBe(200);
  expect((await listed.json()).jobs.map((job:any)=>job.jobId)).toContain(created.jobId);
  await page.locator('#create-more > summary').click();await page.locator('#job-info > summary').click();await expect(page.locator('#job-status')).toContainText('Генерация');await expect(page.locator('#versions')).toBeEnabled();await page.locator('#create-more > summary').click();await page.getByRole('button',{name:'Игровой экран',exact:true}).click();await game.getByRole('button',{name:'Point',exact:true}).tap();await expect(game.locator('#score')).toHaveText('2');release();await expect(page.locator('#job-toast-open')).toBeVisible({timeout:16000});await expect(game.locator('#score')).toHaveText('2');expect(await realm!.evaluate(node=>node===document.querySelector('iframe'))).toBe(true);await expect(page.locator('#export')).toHaveAttribute('href','/api/versions/'+previous.versionId+'/export');const completed=jobs.list('owner')[0];expect(completed.stage).toBe('completed');expect(store.getVersion(completed.versionId!).validationStatus).toBe('passed');}finally{release();await jobs.close();store.close();}
});
test('background completion preserves live round, iframe realm, touch, navigation, single toast and durable job',async({page,context,isMobile,baseURL})=>{
  test.setTimeout(60000);const store=new Store(':memory:');let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);
  const engine=new GenerationEngine([{route:'primary',provider:'ollama.com',model:'gemma4:31b',readiness:async()=>'ready',complete:async()=>{await held;return{code:strictCanvas(),model:'gemma4:31b'};}}],{check:async()=>({profiles:[320,390,844],offline:true,errors:0,scope:'full-html',rendering:{contract:'canvas-webgl-strict-v2',contexts:['2d'],profiles:[320,390,844]}})});
  const jobs=new GenerationJobs(store,engine);const app=createApp(store,engine,undefined,undefined,undefined,undefined,jobs);const previous=store.save(spec,artifact);
  await context.route(baseURL+'/**',async route=>{const req=route.request(),response=await app.request(req.url(),{method:req.method(),headers:{...req.headers(),'accept-encoding':'identity'},...(req.postData()?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
  try{
    await page.goto('/?game='+previous.gameId+'&version='+previous.versionId);const game=page.frameLocator('#game iframe');await game.getByRole('button',{name:'Start',exact:true}).click();await game.getByRole('button',{name:'Point',exact:true}).click();await expect(game.locator('#score')).toHaveText('1');
    const realm=await page.locator('#game iframe').elementHandle();const originalUrl=page.url();await page.getByRole('button',{name:'Создать',exact:true}).click();await page.locator('#prompt').fill('Создай другую игру с 5 грузами');
    const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/jobs'&&r.request().method()==='POST');await page.locator('#generate').click();const job=await(await response).json();await expect.poll(()=>jobs.get('owner',job.jobId).stage).toBe('generating');
    await page.getByRole('button',{name:'Игры',exact:true}).click();await expect(page.locator('#library')).toBeVisible();
    await page.getByRole('button',{name:'Создать',exact:true}).click();await expect(page.locator('#game iframe')).toBeVisible();expect(page.url()).toBe(originalUrl);expect(await realm!.evaluate(node=>node===document.querySelector('#game iframe'))).toBe(true);await expect(game.locator('#score')).toHaveText('1');
    if(isMobile)await game.getByRole('button',{name:'Point',exact:true}).tap();else await game.getByRole('button',{name:'Point',exact:true}).click();await expect(game.locator('#score')).toHaveText('2');
    release();await expect(page.locator('#job-toast-text')).toContainText('Готово: Создай другую игру',{timeout:15000});await page.getByRole('button',{name:'Создать',exact:true}).click();expect(page.url()).toBe(originalUrl);expect(await realm!.evaluate(node=>node===document.querySelector('#game iframe'))).toBe(true);await expect(game.locator('#score')).toHaveText('2');
    await page.locator('#job-toast-dismiss').click();await expect(page.locator('#job-toast-open')).toBeHidden();
    await page.reload();const persisted=await page.evaluate(async()=>await(await fetch('/api/jobs')).json());expect(persisted.jobs.some((item:{jobId:string;stage:string;versionId?:string})=>item.jobId===job.jobId&&item.stage==='completed'&&item.versionId)).toBe(true);await expect(page.locator('#job-toast-open')).toBeHidden();
    await context.setOffline(true);await game.getByRole('button',{name:'Start',exact:true}).click();await game.getByRole('button',{name:'Point',exact:true}).click();await expect(game.locator('#score')).toHaveText('1');await context.setOffline(false);
  }finally{release();await jobs.close();store.close();}
});
test('explicit private version URL opens requested old version on mobile, rejects cross-game version',async({page})=>{
  const first=await(await page.request.post('/__test/seed-version',{data:{prompt:'Первая версия'}})).json();const next=await(await page.request.post('/__test/seed-version',{data:{prompt:'5 грузов',previousVersionId:first.versionId}})).json();
  await page.goto('/?game='+first.gameId+'&version='+first.versionId);await expect(page.locator('#export')).toHaveAttribute('href','/api/versions/'+first.versionId+'/export');await expect(page.locator('#versions')).toHaveValue(first.versionId);
  const other=await(await page.request.post('/__test/seed-version',{data:{prompt:'Другая игра'}})).json();await page.goto('/?game='+other.gameId+'&version='+next.versionId);await expect(page.locator('#message')).toContainText('Версия отсутствует в этой игре');await expect(page.locator('iframe')).toHaveCount(0);
});


import {ChatGptTransport} from '../src/chatgpt.ts';
import {offlineChatGpt,connected,localPolicy,completed,sse} from './chatgpt-helper.ts';
import {BrowserFailure} from '../src/browser-check.ts';

test('ChatGPT A1.5 elapsed minutes persist during wait and closing a tab leaves the durable job active',async({page,context,baseURL})=>{
 test.setTimeout(60000);
 let posts=0,release!:(value:Response)=>void;
 const {session}=offlineChatGpt(async()=>{posts++;return new Promise<Response>(resolve=>{release=resolve;});});await connected(session);
 const store=new Store(':memory:'),engine=new GenerationEngine([new ChatGptTransport(session)],{check:async()=>({profiles:[320,390,844],offline:true,errors:0,scope:'full-html',rendering:{contract:'canvas-webgl-strict-v2',contexts:['2d'],profiles:[320,390,844]}})}),jobs=new GenerationJobs(store,engine);
 const localURL=baseURL!.replace('localhost','127.0.0.1');const app=createApp(store,engine,undefined,localPolicy,undefined,undefined,jobs,undefined,session);
 await context.route(localURL+'/**',async route=>{const req=route.request(),response=await app.request(req.url(),{method:req.method(),headers:{...req.headers(),'accept-encoding':'identity'},...(req.postData()?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
 let reopened:typeof page|undefined;
 try{
  const created=jobs.create('owner','ui-long-wait',{spec:{...spec,prompt:'Long synthetic game'},mode:'live',providerMode:'chatgpt',telegramConsent:false});const id=created.jobId;
  await expect.poll(()=>jobs.get('owner',id).attempts,{timeout:5000}).toBe(1);expect(posts).toBe(1);const old=new Date(Date.now()-754_000).toISOString();store.db.prepare('UPDATE generation_jobs SET created_at=?,updated_at=? WHERE job_id=?').run(old,old,id);
  await page.goto(localURL+'/');await page.locator('#create-more > summary').click();await page.locator('#job-info > summary').click();
  await expect(page.locator('#job-status')).toContainText(/Генерация игрового кода · 12 мин \d+ с/);await expect(page.locator('#job-meta')).not.toContainText('%');
  await page.close();expect(jobs.get('owner',id).stage).toBe('generating');expect(posts).toBe(1);
  reopened=await context.newPage();await reopened.goto(localURL+'/');await reopened.locator('#create-more > summary').click();await reopened.locator('#job-info > summary').click();await expect(reopened.locator('#job-status')).toContainText('Генерация игрового кода');
  release(sse([completed(html)]));await expect.poll(()=>jobs.get('owner',id).stage).toBe('completed');expect(posts).toBe(1);expect(store.list()).toHaveLength(1);
 }finally{release(sse([completed(html)]));await reopened?.close();session.disconnect();await jobs.close();store.close();}
});

test('ChatGPT A1 UI -> API -> durable job -> mock SSE -> real browser validation -> SQLite -> reopen',async({page,context,baseURL})=>{
 test.setTimeout(60000);
 let posts=0;const bodies:any[]=[];
 const {session}=offlineChatGpt(async(_input,init)=>{posts++;bodies.push(JSON.parse(String(init?.body)));return sse([completed(posts===1?strictCanvas():strictCanvas().replaceAll('#4c8290','#7c4290'))]);});
 const store=new Store(':memory:'),engine=new GenerationEngine([new ChatGptTransport(session)],{allowLlmRepair:true}),jobs=new GenerationJobs(store,engine);
 const localURL=baseURL!.replace('localhost','127.0.0.1');const app=createApp(store,engine,undefined,localPolicy,undefined,undefined,jobs,undefined,session);
 await context.route(localURL+'/**',async route=>{const req=route.request(),response=await app.request(req.url(),{method:req.method(),headers:{...req.headers(),'accept-encoding':'identity'},...(req.postData()?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
 try{
  await page.goto(localURL+'/?view=create');await page.getByRole('button',{name:'Создать',exact:true}).click();await page.locator('#create details.tune > summary').click();await expect(page.locator('#provider-mode')).toHaveValue('ollama-cloud');
  await page.locator('#provider-mode').selectOption('chatgpt');await page.locator('#prompt').fill('Synthetic disconnected game');await page.getByRole('button',{name:'Создать игру',exact:true}).click();await expect(page.locator('#message')).toContainText('Подключите ChatGPT');expect(posts).toBe(0);await page.getByRole('button',{name:'Подключить ChatGPT',exact:true}).click();await expect(page.locator('#chatgpt-status')).toHaveText('ChatGPT: подключён');expect(posts).toBe(0);
  await createAndOpen(page,'Создать игру',false);const first=store.getVersion(store.list()[0].versionId);expect(first.provider).toBe('chatgpt');await expect(page.locator('#provenance')).toContainText('ChatGPT');expect(posts).toBe(1);
  await page.getByRole('button',{name:'Изменить',exact:true}).click();await page.locator('#edit-provider-mode').selectOption('chatgpt');await page.locator('#change').fill('Add enemies and preserve existing controls');await openCompletedJobToast(page,'Создать следующую версию');
  expect(posts).toBe(2);expect(bodies[1].input[1].content).toContain(first.html);expect(store.history(first.gameId)).toHaveLength(2);
  const latest=store.history(first.gameId).at(-1)!;await expect(page.locator('#versions')).toHaveValue(latest.versionId);await page.reload();await expect(page.locator('#provenance')).toContainText('ChatGPT');await expect(page.locator('#versions')).toHaveValue(latest.versionId);
  await page.getByRole('button',{name:'Создать',exact:true}).click();await page.getByRole('button',{name:'Отключить ChatGPT',exact:true}).click();await expect(page.locator('#chatgpt-status')).toHaveText('ChatGPT: не подключён');expect(posts).toBe(2);
  await page.screenshot({path:'.local/chatgpt-'+(await page.viewportSize())?.width+'.png',fullPage:true});
 }finally{session.disconnect();await jobs.close();store.close();}
});

test('ChatGPT A1.2 Continue follows server eligibility and revalidates offline without another POST',async({page,context,baseURL})=>{
 let posts=0,accept=false;
 const {session}=offlineChatGpt(async()=>sse([completed(++posts===1?'<!DOCTYPE html><html><body>':html)]));await connected(session);
 const store=new Store(':memory:'),engine=new GenerationEngine([new ChatGptTransport(session)],{check:async()=>{if(!accept)throw new BrowserFailure('BROWSER_START_CONTROL','synthetic validation refusal');return{profiles:[320,390,844],offline:true,errors:0,scope:'full-html',rendering:{contract:'canvas-webgl-strict-v2',contexts:['2d'],profiles:[320,390,844]}};}}),jobs=new GenerationJobs(store,engine);
 const localURL=baseURL!.replace('localhost','127.0.0.1');const app=createApp(store,engine,undefined,localPolicy,undefined,undefined,jobs,undefined,session);
 const settle=async(id:string)=>{await expect.poll(()=>jobs.get('owner',id).stage).toBe('needs_attention');};
 await context.route(localURL+'/**',async route=>{const req=route.request(),response=await app.request(req.url(),{method:req.method(),headers:{...req.headers(),'accept-encoding':'identity'},...(req.postData()?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
 try{
  const partial=jobs.create('owner','ui-partial-checkpoint',{spec,mode:'live',providerMode:'chatgpt',telegramConsent:false});await settle(partial.jobId);
  const full=jobs.create('owner','ui-full-checkpoint',{spec,mode:'live',providerMode:'chatgpt',telegramConsent:false});await settle(full.jobId);session.disconnect();accept=true;
  await page.goto(localURL+'/');await page.locator('#create-more > summary').click();await page.locator('#job-info > summary').click();
  await expect(page.locator('#gen-continue')).toBeVisible();await expect(page.locator('#gen-continue')).toBeEnabled();
  await page.locator('#gen-continue').click();await expect.poll(()=>jobs.get('owner',full.jobId).stage).toBe('completed');
  expect(posts).toBe(2);expect(jobs.get('owner',full.jobId).attempts).toBe(1);expect(jobs.get('owner',partial.jobId).stage).toBe('needs_attention');
 }finally{session.disconnect();await jobs.close();store.close();}
});


test('A1.7 provider statuses, shared budgets and selection survive create/edit/reload without external requests',async({page,context,baseURL})=>{
 const store=new Store(':memory:');const engine=new GenerationEngine([{route:'primary',provider:'openrouter',model:'openrouter/free',readiness:async()=>'ready',complete:async()=>({code:html,model:'synthetic-free'})}],{repairs:0,check:async()=>({profiles:[320,390,844],offline:true,errors:0,scope:'full-html',rendering:{contract:'canvas-webgl-strict-v2',contexts:['2d'],profiles:[320,390,844]}})});
 const jobs=new GenerationJobs(store,engine),app=createApp(store,engine,undefined,undefined,undefined,undefined,jobs);
 await context.route(baseURL+'/**',async route=>{const req=route.request(),response=await app.request(req.url(),{method:req.method(),headers:{...req.headers(),'accept-encoding':'identity'},...(req.postData()?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
 try{
  await page.goto('/');await expect(page.locator('body')).toHaveAttribute('data-ready','true');await page.getByRole('button',{name:'Создать',exact:true}).click();await page.locator('#create details.tune > summary').click();
  await expect(page.locator('#provider-mode option[value="ollama-cloud"]')).toHaveText('Ollama Cloud · gemma4:31b');
  await expect(page.locator('#provider-mode option[value="openrouter"]')).toHaveText('OpenRouter Free · динамическая модель');
  await expect(page.locator('#mode-help')).toContainText('Лимит ответа: 30 мин; задание: до 130 мин для Ollama Cloud и до 35 мин для OpenRouter/ChatGPT');
  await page.locator('#provider-mode').selectOption('openrouter');await createAndOpen(page,'Создать игру',false);
  await expect(page.locator('#edit-provider-mode')).toHaveValue('openrouter');
  await page.getByRole('button',{name:'Изменить',exact:true}).click();await page.locator('#change').fill('Keep the controls and add stars');await openCompletedJobToast(page,'Создать следующую версию');
  await page.reload();await expect(page.locator('body')).toHaveAttribute('data-ready','true');await expect(page.locator('#provider-mode')).toHaveValue('openrouter');await expect(page.locator('#edit-provider-mode')).toHaveValue('openrouter');
  expect(store.list()).toHaveLength(1);expect(store.history(store.list()[0].gameId)).toHaveLength(2);
  // Selection is stored separately from memory-only personal authorization.
  await page.getByRole('button',{name:'Создать',exact:true}).click();await expect(page.locator('#provider-mode option[value="chatgpt"]')).toHaveText('ChatGPT · gpt-6.1-sol · medium');await page.evaluate(()=>localStorage.setItem('yaplix-provider-mode','chatgpt'));await page.reload();await expect(page.locator('body')).toHaveAttribute('data-ready','true');await expect(page.locator('#provider-mode')).toHaveValue('chatgpt');
 }finally{await jobs.close();store.close();}
});

test('A1.7.1 model names stay stable without credentials and selection survives a fresh tab',async({page,context,baseURL})=>{
 await page.goto('/');await expect(page.locator('body')).toHaveAttribute('data-ready','true');
 await page.locator('#create details.tune > summary').click();
 await expect(page.locator('#provider-mode option')).toHaveText([
  'Ollama Cloud · gemma4:31b',
  'OpenRouter Free · динамическая модель',
  'ChatGPT · gpt-6.1-sol · medium'
 ]);
 await expect(page.locator('#model-connection-status')).toContainText('ключ не настроен');
 const jobPosts:string[]=[];page.on('request',request=>{if(request.url().endsWith('/api/jobs')&&request.method()==='POST')jobPosts.push(request.url());});
 await page.locator('#prompt').fill('Make a simple game');await expect(page.locator('#generate')).toBeDisabled();
 expect(jobPosts).toHaveLength(0);await expect(page.locator('#provider-mode')).toHaveValue('ollama-cloud');
 await page.locator('#provider-mode').selectOption('openrouter');
 const other=await context.newPage();await other.goto(baseURL!+'/');await expect(other.locator('body')).toHaveAttribute('data-ready','true');
 await other.locator('#create details.tune > summary').click();
 await expect(other.locator('#provider-mode')).toHaveValue('openrouter');
 await expect(other.locator('#provider-mode option[value="openrouter"]')).toHaveText('OpenRouter Free · динамическая модель');
 await other.close();
});
