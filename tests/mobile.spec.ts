import {createAndOpen} from './ui-jobs-helper.ts';
import {test,expect} from '@playwright/test';
import {html} from './helpers.ts';

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
  await expect(page.locator('#message')).toContainText('Игра сохранена');
  const frame=page.frameLocator('#game iframe');
  await frame.locator('#start').click();
  if(isMobile)await frame.locator('#point').tap();else await frame.locator('#point').click();
  await expect(frame.locator('#score')).toHaveText('1');
  await expect(page.locator('body')).toHaveAttribute('data-screen','play');
  await expect(page.locator('#game iframe')).toHaveCount(1);
});

test('touch, rotation, reduced viewport, focus game and repeated library navigation preserve state with one runtime', async ({page,context,isMobile},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.getByRole('button',{name:'Создать',exact:true}).click();
  await page.locator('#prompt').fill('Собери 3 груза');await createAndOpen(page);
  await expect(page.locator('#message')).toContainText('Игра сохранена');
  const frame=page.frameLocator('#game iframe'),action=async(name:string)=>isMobile?frame.getByRole('button',{name,exact:true}).tap():frame.getByRole('button',{name,exact:true}).click();
  await action('Старт');await action('Вправо');
  const original=page.viewportSize()!;
  let stage='rotation';
  const mark=(value:string)=>{stage=value;};
  info.annotations.push({type:'mobile-scenario',description:'rotation/focus/offline/reopen'});
  page.on('close',()=>console.log('Mobile scenario ended at '+stage));
  for(const size of [{width:original.height,height:original.width},original,{width:original.width,height:Math.min(400,original.height)}]) {
    await page.setViewportSize(size);await expect(frame.locator('#score')).toHaveText('1');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect.poll(()=>frame.locator('canvas').evaluate(c=>(c as HTMLCanvasElement).width===Math.round(c.getBoundingClientRect().width*devicePixelRatio))).toBe(true);
    for(const button of await frame.locator('.controls button').all()){const rect=await button.boundingBox();expect(rect!.width).toBeGreaterThanOrEqual(44);expect(rect!.height).toBeGreaterThanOrEqual(44);}
  }
  mark('focus');await page.setViewportSize(original);await page.getByRole('button',{name:'Игровой экран',exact:true}).click();
  await action('Вправо');await expect(frame.locator('#score')).toHaveText('2');
  await page.screenshot({path:info.outputPath('mobile-game.png')});
  await page.getByRole('button',{name:'Обычный экран',exact:true}).click();
  if(original.width<=760)expect(await page.evaluate(()=>document.querySelector('main')!.getBoundingClientRect().bottom<=document.querySelector('.navigation')!.getBoundingClientRect().top)).toBe(true);
  mark('offline touch');await context.setOffline(true);await action('Вправо');await expect(frame.locator('#status')).toHaveText('Победа');await context.setOffline(false);
  mark('library');await page.getByRole('button',{name:'Игры',exact:true}).click();await expect(page.locator('iframe')).toHaveCount(1);
  const first=page.locator('#games button').first();
  let reads=0;page.on('request',r=>{if(/\/api\/versions\/[^/]+$/.test(new URL(r.url()).pathname))reads++;});
  for(let i=0;i<6;i++){mark('reopen '+i);await first.click();await expect(page.locator('iframe')).toHaveCount(1);await expect(frame.getByRole('button',{name:'Старт',exact:true})).toBeVisible();await page.getByRole('button',{name:'Игры',exact:true}).click();await expect(page.locator('iframe')).toHaveCount(1);}
  mark('complete');expect(reads).toBe(0);expect(errors).toEqual([]);
});

test('generation cancellation, terminal errors, draft and offline diagnostics never leave a busy spinner', async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Создать',exact:true}).click();
  await page.locator('#prompt').fill('Мой сохранённый черновик');
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/jobs'&&r.request().method()==='POST');await page.locator('#generate').click();const job=await(await response).json();expect(job.jobId).toBeTruthy();await page.locator('#jobs-toggle').click();
  const row=page.locator('[data-job="'+job.jobId+'"]');await expect(row).toContainText('LIVE не настроен');await expect(row).toContainText('Мой сохранённый черновик');
  await row.getByRole('button',{name:'Продолжить генерацию'}).click();await expect(row).toContainText('LIVE не настроен');await expect(page.locator('#generate')).toBeEnabled();await expect(page.locator('iframe')).toHaveCount(0);
  await page.reload();await expect(page.locator('#prompt')).toHaveValue('Мой сохранённый черновик');
  await page.route('**/api/games',route=>route.abort());await page.reload();await expect(page.locator('#message')).toContainText('Сервер недоступен');
  await expect(page.locator('#generate')).toBeEnabled();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


test('version and replay controls stay disabled until the displayed game finishes loading', async({page})=>{
  let release!:()=>void;const paused=new Promise<void>(done=>release=done);
  await page.route('**/analytics',async route=>{await paused;await route.continue();});
  try{
    await page.goto('/');await page.getByRole('button',{name:'Создать',exact:true}).click();
    await page.locator('#prompt').fill('Собери 3 груза');await createAndOpen(page);
    await expect(page.frameLocator('#game iframe').getByRole('button',{name:'Старт',exact:true})).toBeVisible();
    await expect(page.locator('#versions')).toBeDisabled();await expect(page.locator('#replay')).toBeDisabled();
    release();await expect(page.locator('#message')).toContainText('Игра сохранена');
    await expect(page.locator('#versions')).toBeEnabled();await expect(page.locator('#replay')).toBeEnabled();
  }finally{release();}
});
