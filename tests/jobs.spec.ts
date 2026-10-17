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
 const engine=new GenerationEngine([{route:'primary',provider:'ollama.com',model:'gemma4:31b',readiness:async()=>'ready',complete:async m=>{messages.push(structuredClone(m));return{code:messages.length===1?html:html.replace('Synthetic test game','Edited game'),model:'gemma4:31b'};}}],{repairs:0,check:async()=>({profiles:[320,390],offline:true,errors:0,scope:'full-html'})});
 const jobs=new GenerationJobs(store,engine),app=createApp(store,engine,undefined,undefined,undefined,undefined,jobs);
 await context.route(baseURL+'/**',async route=>{const req=route.request(),response=await app.request(req.url(),{method:req.method(),headers:{...req.headers(),'accept-encoding':'identity'},...(req.postData()?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
 try{
  await page.goto('/');await page.getByRole('button',{name:'Создать',exact:true}).click();await expect(page.locator('#provider-mode')).toHaveValue('ollama-cloud');await expect(page.locator('#mode')).toHaveCount(0);
  await createAndOpen(page,'Создать игру',false);const first=store.getVersion(store.list()[0].versionId);await expect(page.locator('#provenance')).toContainText('механика не проверена');await expect(page.locator('#provenance')).not.toContainText('gameplay проверен частично');
  await expect(page.locator('#edit-provider-mode')).toHaveValue('ollama-cloud');
  expect(await page.locator('#edit-provider-mode option').evaluateAll(nodes=>nodes.map(n=>(n as HTMLOptionElement).value))).toEqual(['ollama-cloud','openrouter']);
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

  await expect(page.locator('#mode')).toHaveCount(0);expect(await page.locator('#provider-mode option').evaluateAll(options=>options.map(o=>(o as HTMLOptionElement).value))).toEqual(['ollama-cloud','openrouter']);
  await page.locator('#provider-mode').selectOption('openrouter');await page.locator('#prompt').fill('Собери игру три в ряд');
  await page.reload();await page.getByRole('button',{name:'Создать',exact:true}).click();
  await expect(page.locator('#provider-mode')).toHaveValue('openrouter');await expect(page.locator('#prompt')).toHaveValue('Собери игру три в ряд');
  const selector=await page.locator('#provider-mode').boundingBox();expect(selector!.x).toBeGreaterThanOrEqual(0);expect(selector!.width).toBeLessThanOrEqual(await page.evaluate(()=>innerWidth));
});
test('controlled LIVE worker runs while touch round continues; completed checked version never opens automatically',async({page,context,baseURL},info)=>{
  test.setTimeout(35000);
  test.skip(!['chromium-320','webkit-390'].includes(info.project.name),'Controlled LIVE worker on small Chromium/WebKit; other profiles run key-free background scenario.');
  const store=new Store(':memory:');let release!:()=>void;const held=new Promise<void>(done=>release=done);
  const engine=new GenerationEngine([{route:'primary',provider:'ollama.com',model:'gemma4:31b',readiness:async()=>'ready',complete:async()=>{await held;return{code:html,model:'gemma4:31b'};}}],{timeoutMs:15000});
  const jobs=new GenerationJobs(store,engine),app=createApp(store,engine,undefined,undefined,undefined,undefined,jobs);const previous=store.save(spec,demoArtifact(spec));
  await context.route(baseURL+'/**',async route=>{const req=route.request(),response=await app.request(req.url(),{method:req.method(),headers:{...req.headers(),'accept-encoding':'identity'},...(req.postData()?{body:req.postData()!}:{})});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
  try{await page.goto('/?game='+previous.gameId);const game=page.frameLocator('#game iframe');await game.getByRole('button',{name:'Старт',exact:true}).tap();await game.getByRole('button',{name:'Вправо',exact:true}).tap();const realm=await page.locator('iframe').elementHandle();await page.getByRole('button',{name:'Создать',exact:true}).click();await page.locator('#generate').click();await page.locator('#jobs-toggle').click();await expect(page.locator('#jobs-list')).toContainText('Генерация');await expect(page.locator('#versions')).toBeEnabled();await page.getByRole('button',{name:'Игра',exact:true}).click();await game.getByRole('button',{name:'Вправо',exact:true}).tap();await expect(game.locator('#score')).toHaveText('2');release();await expect(page.locator('#job-toast-open')).toBeVisible({timeout:16000});await expect(game.locator('#score')).toHaveText('2');expect(await realm!.evaluate(node=>node===document.querySelector('iframe'))).toBe(true);await expect(page.locator('#export')).toHaveAttribute('href','/api/versions/'+previous.versionId+'/export');const completed=jobs.list('owner')[0];expect(completed.stage).toBe('completed');expect(store.getVersion(completed.versionId!).validationStatus).toBe('passed');}finally{release();await jobs.close();store.close();}
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
