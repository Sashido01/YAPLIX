import {strictCanvas} from './strict-canvas-fixtures.ts';
import {test,expect} from '@playwright/test';
import {createAndOpen} from './ui-jobs-helper.ts';
import {spec,html} from './helpers.ts';
import {Store} from '../src/store.ts';
import {createApp} from '../src/api.ts';
import {GenerationEngine} from '../src/live.ts';
import {demoArtifact} from '../src/demo.ts';
import {GenerationJobs} from '../src/jobs.ts';

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
  await page.locator('#change').fill('Add enemies and preserve existing controls');await createAndOpen(page,'Создать следующую версию',false);
  expect(messages).toHaveLength(2);expect(messages[1][1].content).toContain(first.html);expect(messages[1][1].content).toContain('Add enemies');
  const history=store.history(first.gameId);expect(history).toHaveLength(2);const second=history[1];
  await page.locator('#versions').selectOption(first.versionId);await expect(page.locator('#export')).toHaveAttribute('href','/api/versions/'+first.versionId+'/export');
  await page.reload();await expect(page.locator('#versions')).toHaveValue(first.versionId);await page.locator('#versions').selectOption(second.versionId);
  const game=page.frameLocator('#game iframe');await game.getByRole('button',{name:'Start',exact:true}).click();await game.getByRole('button',{name:'Point',exact:true}).click();await expect(game.locator('#score')).toHaveText('1');
  const exported=await app.request('/api/versions/'+second.versionId+'/export');expect(await exported.text()).toBe(store.getVersion(second.versionId).html);
  expect(await page.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts');expect(store.getVersion(first.versionId).html).toBe(first.html);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(info.project.name==='chromium-390')await page.screenshot({path:'.local/micro023/edit-mobile.png',fullPage:true});
 }finally{await jobs.close();store.close();}
});

test('Full HTML UI exposes two manual provider modes and restores the selected mode and idea',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Создать',exact:true}).click();

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
  const jobs=new GenerationJobs(store,engine),app=createApp(store,engine,undefined,undefined,undefined,undefined,jobs);const previous=store.save(spec,demoArtifact(spec));
  await context.route(baseURL+'/**',async route=>{const req=route.request(),response=await app.request(req.url(),{method:req.method(),headers:{...req.headers(),'accept-encoding':'identity'},...(req.postData()?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
  try{await page.goto('/?game='+previous.gameId);const game=page.frameLocator('#game iframe');await game.getByRole('button',{name:'Старт',exact:true}).tap();await game.getByRole('button',{name:'Вправо',exact:true}).tap();const realm=await page.locator('iframe').elementHandle();await page.getByRole('button',{name:'Создать',exact:true}).click();const createdResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/jobs'&&r.request().method()==='POST');
  await page.locator('#generate').click();const response=await createdResponse;
  expect(response.status(),await response.text()).toBe(202);const created=await response.json();
  expect(jobs.get('owner',created.jobId).providerMode).toBe('ollama-cloud');
  expect(jobs.list('owner').map(job=>job.jobId)).toContain(created.jobId);
  const listed=await app.request('/api/jobs');expect(listed.status).toBe(200);
  expect((await listed.json()).jobs.map((job:any)=>job.jobId)).toContain(created.jobId);
  await page.locator('#jobs-toggle').click();await expect(page.locator('[data-job="'+created.jobId+'"]')).toContainText('Генерация');await expect(page.locator('#versions')).toBeEnabled();await page.getByRole('button',{name:'Игра',exact:true}).click();await game.getByRole('button',{name:'Вправо',exact:true}).tap();await expect(game.locator('#score')).toHaveText('2');release();await expect(page.locator('#job-toast-open')).toBeVisible({timeout:16000});await expect(game.locator('#score')).toHaveText('2');expect(await realm!.evaluate(node=>node===document.querySelector('iframe'))).toBe(true);await expect(page.locator('#export')).toHaveAttribute('href','/api/versions/'+previous.versionId+'/export');const completed=jobs.list('owner')[0];expect(completed.stage).toBe('completed');expect(store.getVersion(completed.versionId!).validationStatus).toBe('passed');}finally{release();await jobs.close();store.close();}
});
test('background completion preserves live round, iframe realm, touch, navigation, single toast and durable job',async({page,context,isMobile})=>{
  await page.goto('/');await page.getByRole('button',{name:'Создать',exact:true}).click();await createAndOpen(page);
  const game=page.frameLocator('#game iframe');await game.getByRole('button',{name:'Старт',exact:true}).click();await game.getByRole('button',{name:'Вправо',exact:true}).click();await expect(game.locator('#score')).toHaveText('1');
  const realm=await page.locator('#game iframe').elementHandle();const originalUrl=page.url();
  await page.getByRole('button',{name:'Создать',exact:true}).click();await page.locator('#prompt').fill('Создай другую игру с 5 грузами');
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/jobs'&&r.request().method()==='POST');await page.locator('#generate').click();const job=await(await response).json();
  await page.getByRole('button',{name:'Игра',exact:true}).click();await expect(page.locator('#job-toast-text')).toContainText('Игра сохранена');
  expect(page.url()).toBe(originalUrl);expect(await realm!.evaluate(node=>node===document.querySelector('#game iframe'))).toBe(true);await expect(game.locator('#score')).toHaveText('1');
  if(isMobile)await game.getByRole('button',{name:'Вправо',exact:true}).tap();else await game.getByRole('button',{name:'Вправо',exact:true}).click();await expect(game.locator('#score')).toHaveText('2');
  const toastRect=await page.locator('#job-toast').boundingBox(),frameRect=await page.locator('#game iframe').boundingBox();expect(toastRect!.y+toastRect!.height).toBeLessThanOrEqual(frameRect!.y);
  await page.locator('#job-toast-dismiss').click();await page.waitForTimeout(2300);await expect(page.locator('#job-toast-open')).toBeHidden();await expect(game.locator('#score')).toHaveText('2');
  await page.getByRole('button',{name:'Игры',exact:true}).click();await page.getByRole('button',{name:'Игра',exact:true}).click();expect(await realm!.evaluate(node=>node===document.querySelector('#game iframe'))).toBe(true);await expect(game.locator('#score')).toHaveText('2');
  await page.reload();await page.locator('#jobs-toggle').click();await expect(page.locator('[data-job="'+job.jobId+'"]')).toContainText('Готово');await expect(page.locator('#job-toast-open')).toBeHidden();
  await context.setOffline(true);await game.getByRole('button',{name:'Старт',exact:true}).click();await game.getByRole('button',{name:'Вправо',exact:true}).click();await expect(game.locator('#score')).toHaveText('1');await context.setOffline(false);
});
test('explicit private version URL opens requested old version on mobile, rejects cross-game version',async({page})=>{
  const first=await(await page.request.post('/api/games',{data:{mode:'demo',spec}})).json();const next=await(await page.request.post('/api/games/'+first.gameId+'/versions',{data:{mode:'demo',spec:{...spec,prompt:'5 грузов'},previousVersionId:first.versionId}})).json();
  await page.goto('/?game='+first.gameId+'&version='+first.versionId);await expect(page.locator('#export')).toHaveAttribute('href','/api/versions/'+first.versionId+'/export');await expect(page.locator('#versions')).toHaveValue(first.versionId);
  const other=await(await page.request.post('/api/games',{data:{mode:'demo',spec}})).json();await page.goto('/?game='+other.gameId+'&version='+next.versionId);await expect(page.locator('#message')).toContainText('Версия отсутствует в этой игре');await expect(page.locator('iframe')).toHaveCount(0);
});


import {ChatGptTransport} from '../src/chatgpt.ts';
import {offlineChatGpt,connected,localPolicy,completed,sse} from './chatgpt-helper.ts';
import {BrowserFailure} from '../src/browser-check.ts';

test('ChatGPT A1.5 elapsed minutes persist during wait and closing a tab leaves the durable job active',async({page,context,baseURL})=>{
 let posts=0,release!:(value:Response)=>void;
 const {session}=offlineChatGpt(async()=>{posts++;return new Promise<Response>(resolve=>{release=resolve;});});await connected(session);
 const store=new Store(':memory:'),engine=new GenerationEngine([new ChatGptTransport(session)],{check:async()=>({profiles:[320,390,844],offline:true,errors:0,scope:'full-html',rendering:{contract:'canvas-webgl-strict-v2',contexts:['2d'],profiles:[320,390,844]}})}),jobs=new GenerationJobs(store,engine);
 const app=createApp(store,engine,undefined,localPolicy,undefined,undefined,jobs,undefined,session);
 await context.route(baseURL+'/**',async route=>{const req=route.request(),response=await app.request(req.url(),{method:req.method(),headers:{...req.headers(),'accept-encoding':'identity'},...(req.postData()?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
 let reopened:typeof page|undefined;
 try{
  await page.clock.install();
  await page.goto('/?view=create');await page.locator('#provider-mode').selectOption('chatgpt');await page.locator('#prompt').fill('Long synthetic game');await page.getByRole('button',{name:'Создать игру',exact:true}).click();
  await expect.poll(()=>posts).toBe(1);const id=jobs.list('owner')[0].jobId;
  await page.locator('#jobs-toggle').click();await page.clock.fastForward(754_000);
  const row=page.locator('[data-job="'+id+'"]');await expect(row).toContainText(/ChatGPT создаёт игру · 12 мин \d+ с/);await expect(row).not.toContainText('%');
  await page.close();expect(jobs.get('owner',id).stage).toBe('generating');expect(posts).toBe(1);
  reopened=await context.newPage();await reopened.goto('/');await reopened.locator('#jobs-toggle').click();await expect(reopened.locator('[data-job="'+id+'"]')).toContainText('ChatGPT создаёт игру');
  release(sse([completed(html)]));await expect.poll(()=>jobs.get('owner',id).stage).toBe('completed');expect(posts).toBe(1);expect(store.list()).toHaveLength(1);
 }finally{await reopened?.close();session.disconnect();await jobs.close();store.close();}
});

test('ChatGPT A1 UI -> API -> durable job -> mock SSE -> real browser validation -> SQLite -> reopen',async({page,context,baseURL})=>{
 test.setTimeout(60000);
 let posts=0;const bodies:any[]=[];
 const {session}=offlineChatGpt(async(_input,init)=>{posts++;bodies.push(JSON.parse(String(init?.body)));return sse([completed(posts===1?strictCanvas():strictCanvas().replaceAll('#4c8290','#7c4290'))]);});
 const store=new Store(':memory:'),engine=new GenerationEngine([new ChatGptTransport(session)],{allowLlmRepair:true}),jobs=new GenerationJobs(store,engine);
 const app=createApp(store,engine,undefined,localPolicy,undefined,undefined,jobs,undefined,session);
 await context.route(baseURL+'/**',async route=>{const req=route.request(),response=await app.request(req.url(),{method:req.method(),headers:{...req.headers(),'accept-encoding':'identity'},...(req.postData()?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
 try{
  await page.goto('/?view=create');await expect(page.locator('#provider-mode')).toHaveValue('ollama-cloud');
  await page.locator('#provider-mode').selectOption('chatgpt');await page.getByRole('button',{name:'Создать игру',exact:true}).click();await expect(page.locator('#message')).toContainText('Подключите ChatGPT');expect(posts).toBe(0);expect(jobs.list('owner')).toHaveLength(0);
  await page.getByRole('button',{name:'Подключить ChatGPT',exact:true}).click();await expect(page.locator('#chatgpt-status')).toHaveText('ChatGPT: подключён');expect(posts).toBe(0);
  await createAndOpen(page,'Создать игру',false);const first=store.getVersion(store.list()[0].versionId);expect(first.provider).toBe('chatgpt');await expect(page.locator('#provenance')).toContainText('ChatGPT');expect(posts).toBe(1);
  await page.locator('#edit-provider-mode').selectOption('chatgpt');await page.locator('#change').fill('Add enemies and preserve existing controls');await createAndOpen(page,'Создать следующую версию',false);
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
 const app=createApp(store,engine,undefined,localPolicy,undefined,undefined,jobs,undefined,session);
 const settle=async(id:string)=>{await expect.poll(()=>jobs.get('owner',id).stage).toBe('needs_attention');};
 await context.route(baseURL+'/**',async route=>{const req=route.request(),response=await app.request(req.url(),{method:req.method(),headers:{...req.headers(),'accept-encoding':'identity'},...(req.postData()?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
 try{
  const partial=jobs.create('owner','ui-partial-checkpoint',{spec,mode:'live',providerMode:'chatgpt',telegramConsent:false});await settle(partial.jobId);
  const full=jobs.create('owner','ui-full-checkpoint',{spec,mode:'live',providerMode:'chatgpt',telegramConsent:false});await settle(full.jobId);session.disconnect();accept=true;
  await page.goto('/');await page.locator('#jobs-toggle').click();
  const denied=page.locator('[data-job="'+partial.jobId+'"]'),allowed=page.locator('[data-job="'+full.jobId+'"]');
  await expect(denied.getByRole('button',{name:'Продолжить генерацию'})).toBeDisabled();
  await expect(allowed.getByRole('button',{name:'Продолжить генерацию'})).toBeEnabled();
  await allowed.getByRole('button',{name:'Продолжить генерацию'}).click();await expect(allowed).toContainText('Готово');
  expect(posts).toBe(2);expect(jobs.get('owner',full.jobId).attempts).toBe(1);expect(jobs.get('owner',partial.jobId).stage).toBe('needs_attention');
 }finally{session.disconnect();await jobs.close();store.close();}
});


test('A1.7 provider statuses, shared budgets and selection survive create/edit/reload without external requests',async({page,context,baseURL})=>{
 const store=new Store(':memory:');const engine=new GenerationEngine([{route:'primary',provider:'openrouter',model:'openrouter/free',readiness:async()=>'ready',complete:async()=>({code:html,model:'synthetic-free'})}],{repairs:0,check:async()=>({profiles:[320,390,844],offline:true,errors:0,scope:'full-html',rendering:{contract:'canvas-webgl-strict-v2',contexts:['2d'],profiles:[320,390,844]}})});
 const jobs=new GenerationJobs(store,engine),app=createApp(store,engine,undefined,undefined,undefined,undefined,jobs);
 await context.route(baseURL+'/**',async route=>{const req=route.request(),response=await app.request(req.url(),{method:req.method(),headers:{...req.headers(),'accept-encoding':'identity'},...(req.postData()?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
 try{
  await page.goto('/');await expect(page.locator('body')).toHaveAttribute('data-ready','true');await page.getByRole('button',{name:'Создать',exact:true}).click();
  await expect(page.locator('#provider-mode option[value="ollama-cloud"]')).toHaveText('Ollama Cloud · Не настроен');
  await expect(page.locator('#provider-mode option[value="openrouter"]')).toContainText('Требуется проверка подключения');
  await expect(page.locator('#mode-help')).toContainText('Лимит ответа: 30 мин; всё задание, включая очередь и сохранение: 35 мин');
  await page.locator('#provider-mode').selectOption('openrouter');await createAndOpen(page,'Создать игру',false);
  await expect(page.locator('#edit-provider-mode')).toHaveValue('openrouter');
  await page.locator('#change').fill('Keep the controls and add stars');await createAndOpen(page,'Создать следующую версию',false);
  await page.reload();await expect(page.locator('body')).toHaveAttribute('data-ready','true');await expect(page.locator('#provider-mode')).toHaveValue('openrouter');await expect(page.locator('#edit-provider-mode')).toHaveValue('openrouter');
  expect(store.list()).toHaveLength(1);expect(store.history(store.list()[0].gameId)).toHaveLength(2);
  // Selection is stored separately from memory-only personal authorization.
  await page.getByRole('button',{name:'Создать',exact:true}).click();await page.locator('#provider-mode').selectOption('chatgpt');await page.reload();await expect(page.locator('body')).toHaveAttribute('data-ready','true');await expect(page.locator('#provider-mode')).toHaveValue('chatgpt');
 }finally{await jobs.close();store.close();}
});
