import {test,expect} from '@playwright/test';
import {html,spec} from './helpers.ts';
import {prepareSyntheticProviderUI,restoreUnconfiguredUIReadiness} from './ui-jobs-helper.ts';

test('section navigation shows only the selected mobile workspace',async({page})=>{
 await page.goto('/');
 await expect(page.locator('nav.navigation button')).toHaveText(['Создать','Игры','Арена']);
 await page.locator('[data-view="library"]:visible').click();
 await expect(page.locator('#library')).toBeVisible();await expect(page.locator('#arena')).toBeHidden();
 await page.locator('[data-view="create"]:visible').click();
 await expect(page.locator('#create')).toBeVisible();await expect(page.locator('#library')).toBeHidden();await expect(page.locator('#arena')).toBeHidden();
});

async function createAndOpen(page:import('@playwright/test').Page,button='Создать игру',fixture=true){
  if(fixture)await prepareSyntheticProviderUI(page);
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/jobs'&&r.request().method()==='POST');
  await page.getByRole('button',{name:button,exact:true}).click();const job=await(await response).json();
  expect(job.jobId).toBeTruthy();
  // UI-002 opens the tracked successful job in the workspace; the old archive toggle was removed.
  await expect(page.locator('#game iframe')).toBeVisible();
  if(fixture)await restoreUnconfiguredUIReadiness(page);
  return job;
}

test('fixed bottom game controls remain reachable above platform navigation',async({page,isMobile})=>{
  // Independently authored fixture models the layout found in a real cloud game.
  const fixed=html.replace('</style>','#point{position:fixed;bottom:0;left:0;margin:0;width:100%}</style>');
  await page.route(/\/api\/versions\/[^/]+$/,async route=>{
    const response=await route.fetch(),version=await response.json();
    await route.fulfill({response,json:{...version,html:fixed}});
  });
  await page.goto('/');await page.getByRole('button',{name:'Создать',exact:true}).click();
  await page.locator('#prompt').fill('Космический корабль уклоняется от движущихся астероидов. Длинное название игры занимает несколько строк на маленьком экране.');
  await createAndOpen(page);
  await expect(page.locator('#message')).toContainText(/Игра (сохранена|готова)/);
  const frame=page.frameLocator('#game iframe');
  await frame.locator('#start').click();
  if(isMobile)await frame.locator('#point').tap();else await frame.locator('#point').click();
  await expect(frame.locator('#score')).toHaveText('1');
  await expect(page.locator('body')).toHaveAttribute('data-screen','create');
  await expect(page.locator('#game iframe')).toHaveCount(1);
});

test('touch, rotation, section navigation, export and UI diagnostics preserve state with one runtime', async ({page,context,isMobile},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.getByRole('button',{name:'Создать',exact:true}).click();
  await page.locator('#prompt').fill('Собери 3 груза');const created=await createAndOpen(page);
  const job=await(await page.request.get('/api/jobs/'+created.jobId)).json();
  await expect(page.locator('#message')).toContainText(/Игра (сохранена|готова)/);
  const frame=page.frameLocator('#game iframe'),action=async(name:string)=>isMobile?frame.getByRole('button',{name,exact:true}).tap():frame.getByRole('button',{name,exact:true}).click();
  await action('Start');await action('Point');
  const original=page.viewportSize()!;
  let stage='rotation';
  const mark=(value:string)=>{stage=value;};
  info.annotations.push({type:'mobile-scenario',description:'rotation/focus/offline/reopen'});
  page.on('close',()=>console.log('Mobile scenario ended at '+stage));
  for(const size of [{width:original.height,height:original.width},original,{width:original.width,height:Math.min(400,original.height)}]) {
    await page.setViewportSize(size);await expect(frame.locator('#score')).toHaveText('1');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect.poll(()=>frame.locator('canvas').evaluate(c=>{const canvas=c as HTMLCanvasElement,rect=canvas.getBoundingClientRect(),expected=Math.round(rect.width*devicePixelRatio);return canvas.width===expected?'ok':`actual=${canvas.width}, expected=${expected}, rectWidth=${rect.width}, dpr=${devicePixelRatio}, innerWidth=${innerWidth}`})).toBe('ok');
    for(const button of await frame.locator('.controls button').all()){const rect=await button.boundingBox();expect(rect!.width).toBeGreaterThanOrEqual(44);expect(rect!.height).toBeGreaterThanOrEqual(44);}
  }
  mark('focus');await page.setViewportSize(original);await page.getByRole('button',{name:'Игровой экран',exact:true}).click();
  await action('Point');await expect(frame.locator('#score')).toHaveText('2');
  await page.screenshot({path:info.outputPath('mobile-game.png')});
  await page.getByRole('button',{name:'Обычный экран',exact:true}).click();
  if(original.width<=760)expect(await page.evaluate(()=>document.querySelector('main')!.getBoundingClientRect().bottom<=document.querySelector('.navigation')!.getBoundingClientRect().top)).toBe(true);
  mark('offline touch');await context.setOffline(true);await action('Point');await expect(frame.locator('#status')).toHaveText('Won');await context.setOffline(false);
  mark('library');await page.getByRole('button',{name:'Игры',exact:true}).click();await expect(page.locator('iframe')).toHaveCount(1);
  await page.getByRole('button',{name:'Арена',exact:true}).click();await expect(page.locator('#arena')).toBeVisible();
  await page.getByRole('button',{name:'Создать',exact:true}).click();await expect(page.locator('#game iframe')).toBeVisible();
  await page.getByRole('button',{name:'Игры',exact:true}).click();
  const first=page.locator('#games button[data-version="'+job.versionId+'"]');
  let reads=0;page.on('request',r=>{if(/\/api\/versions\/[^/]+$/.test(new URL(r.url()).pathname))reads++;});
  for(let i=0;i<6;i++){mark('reopen '+i);await first.click();await expect(page.locator('iframe')).toHaveCount(1);await expect(frame.getByRole('button',{name:'Start',exact:true})).toBeVisible();await page.getByRole('button',{name:'Игры',exact:true}).click();await expect(page.locator('iframe')).toHaveCount(1);}
  await page.route('**/api/versions/*/sessions',route=>route.abort());
  const failedActionTrace=page.waitForResponse(response=>{
    const request=response.request();
    try{return new URL(response.url()).pathname.endsWith('/ui-trace')&&request.method()==='POST'&&request.postDataJSON().event==='ui.api_error';}catch{return false;}
  });
  await first.click();await expect(page.locator('#message')).toContainText('Сервер недоступен');
  expect((await failedActionTrace).ok()).toBe(true);
  await page.unroute('**/api/versions/*/sessions');
  await page.getByRole('button',{name:'Создать',exact:true}).click();
  const download=page.waitForEvent('download');await page.locator('#export').click();await download;
  const diagnostics=async()=>await(await page.request.get('/api/jobs/'+created.jobId+'/diagnostics')).json();
  await expect.poll(async()=>(await diagnostics()).events.some((event:{event:string})=>event.event==='ui.api_error')).toBe(true);
  const seen=(await diagnostics()).events.map((event:{event:string})=>event.event);
  for(const event of ['ui.game_opened','ui.viewport_changed','ui.panel_changed','ui.api_error','ui.export_opened','version.export.completed'])expect(seen,event).toContain(event);
  mark('complete');expect(reads).toBe(0);expect(errors).toEqual([]);
});

test('late active job poll cannot detach the timer or hide an opened game on mobile',async({page,isMobile})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:390,height:700});
  await page.goto('/');
  // Let the initial library fetch settle before replacing this document.
  // Windows WebKit reports an unloading fetch as an access-control page error.
  await expect(page.locator('body')).toHaveAttribute('data-ready','true');
  const created=await page.request.post('/api/jobs',{data:{spec:{...spec,prompt:'Собери 3 груза'},providerMode:'ollama-cloud',idempotencyKey:crypto.randomUUID()}});
  const {jobId}=await created.json();
  await expect.poll(async()=>{const result=await page.request.get('/api/jobs/'+jobId);return(await result.json()).stage;},{timeout:15000}).toBe('completed');
  const completedResponse=await page.request.get('/api/jobs/'+jobId),completed=await completedResponse.json();
  await page.goto('/?game='+completed.gameId+'&version='+completed.versionId);
  await expect(page.locator('#game iframe')).toBeVisible();
  expect(completed.stage).toBe('completed');
  await page.route('**/api/jobs',route=>route.request().method()==='GET'
    ?route.fulfill({json:{jobs:[{...completed,stage:'generating',versionId:undefined,errorCode:null}]}})
    :route.continue());
  await page.waitForTimeout(2300);
  await expect(page.locator('#game iframe')).toBeVisible();
  await expect(page.locator('#genstate')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const frame=page.frameLocator('#game iframe');
  if(isMobile)await frame.getByRole('button',{name:'Start',exact:true}).tap();else await frame.getByRole('button',{name:'Start',exact:true}).click();
  if(isMobile)await frame.getByRole('button',{name:'Point',exact:true}).tap();else await frame.getByRole('button',{name:'Point',exact:true}).click();
  await expect(frame.locator('#score')).toHaveText('1');
  await page.getByRole('button',{name:'Игровой экран',exact:true}).click();
  await expect(page.locator('#game iframe')).toBeVisible();
  await page.getByRole('button',{name:'Обычный экран',exact:true}).click();
  await page.getByRole('button',{name:'Игры',exact:true}).click();
  await expect(page.locator('#games')).toBeVisible();
  await page.getByRole('button',{name:'Создать',exact:true}).click();
  await expect(page.locator('#game iframe')).toBeVisible();
  expect(errors).toEqual([]);
});

test('terminal job errors, draft and offline diagnostics remain visible without a busy spinner', async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Создать',exact:true}).click();
  await page.locator('#prompt').fill('YAPLIX_TEST_PROVIDER_FAILURE — Мой сохранённый черновик');
  // The test-only provider fails deterministically after one synthetic POST;
  // no external credentials or upstream are involved.
  await prepareSyntheticProviderUI(page);
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/jobs'&&r.request().method()==='POST');await page.locator('#generate').click();const job=await(await response).json();expect(job.jobId).toBeTruthy();
  await expect.poll(async()=>{const result=await page.request.get('/api/jobs/'+job.jobId);return(await result.json()).stage;}).toMatch(/^(failed|needs_attention)$/);
  await page.locator('#create-more > summary').click();await page.locator('#job-info > summary').click();
  await expect(page.locator('#job-status')).toContainText(/Генерация не завершена|Ошибка генерации|Нужно действие пользователя/);
  await expect(page.locator('#job-meta')).toContainText('попыток');
  await page.locator('#job-history > summary').click();await expect(page.locator('#job-history-list')).toContainText('Мой сохранённый черновик');
  await page.locator('#job-details > summary').click();const detail=page.locator('#job-detail-body');await expect(detail).toContainText('LIVE не настроен');
  const download=page.waitForEvent('download');await detail.getByRole('button',{name:/Скачать диагностический отчёт/}).click();expect((await download).suggestedFilename()).toContain('yaplix-diagnostics');
  await expect(detail).toContainText('LLM POST: отправлено');await expect(page.locator('#generate')).toBeEnabled();await expect(page.locator('iframe')).toHaveCount(0);
  await page.reload();await expect(page.locator('#prompt')).toHaveValue('YAPLIX_TEST_PROVIDER_FAILURE — Мой сохранённый черновик');
  await page.route('**/api/games',route=>route.abort());await page.reload();await expect(page.locator('#message')).toContainText('Сервер недоступен');
  await expect(page.locator('#generate')).toBeEnabled();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


test('version and replay controls stay disabled during creation and enable for the loaded game', async({page})=>{
  let release!:()=>void,requested=false;const paused=new Promise<void>(done=>release=done);
  await page.route('**/api/jobs',async route=>{if(route.request().method()==='POST'){const response=await route.fetch({postData:JSON.stringify(route.request().postDataJSON())});requested=true;await paused;await route.fulfill({response});}else await route.continue();});
  try{
    await page.goto('/');await page.getByRole('button',{name:'Создать',exact:true}).click();
    await page.locator('#prompt').fill('Собери 3 груза');
    // This test controls the job POST itself, so it must also satisfy the UI's
    // provider preflight through the shared synthetic readiness fixture.
    await prepareSyntheticProviderUI(page);
    const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/jobs'&&r.request().method()==='POST');await page.getByRole('button',{name:'Создать игру',exact:true}).click();
    await expect.poll(()=>requested).toBe(true);
    await expect(page.locator('#versions')).toBeDisabled();await expect(page.locator('#replay')).toBeDisabled();
    release();await response;await expect(page.locator('#game iframe')).toBeVisible();
    await expect(page.frameLocator('#game iframe').getByRole('button',{name:'Start',exact:true})).toBeVisible();
    await restoreUnconfiguredUIReadiness(page);
    await expect(page.locator('#versions')).toBeEnabled();await expect(page.locator('#replay')).toBeEnabled();
  }finally{release();}
});
