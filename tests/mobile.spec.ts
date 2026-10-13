import {test,expect} from '@playwright/test';

test('touch, rotation, reduced viewport, focus game and repeated library navigation preserve state with one runtime', async ({page,context,isMobile},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.getByRole('button',{name:'Создать',exact:true}).click();
  await page.locator('#prompt').fill('Собери 3 груза');await page.getByRole('button',{name:'Создать игру',exact:true}).click();
  await expect(page.locator('#message')).toContainText('Игра сохранена');
  const frame=page.frameLocator('#game iframe'),action=async(name:string)=>isMobile?frame.getByRole('button',{name,exact:true}).tap():frame.getByRole('button',{name,exact:true}).click();
  await action('Старт');await action('Груз');
  const original=page.viewportSize()!;
  for(const size of [{width:original.height,height:original.width},original,{width:original.width,height:Math.min(400,original.height)}]) {
    await page.setViewportSize(size);await expect(frame.locator('#score')).toHaveText('1');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect.poll(()=>frame.locator('canvas').evaluate(c=>(c as HTMLCanvasElement).width===Math.round(c.getBoundingClientRect().width*devicePixelRatio))).toBe(true);
    for(const button of await frame.locator('.controls button').all()){const rect=await button.boundingBox();expect(rect!.width).toBeGreaterThanOrEqual(44);expect(rect!.height).toBeGreaterThanOrEqual(44);}
  }
  await page.setViewportSize(original);await page.getByRole('button',{name:'Игровой экран',exact:true}).click();
  await action('Груз');await expect(frame.locator('#score')).toHaveText('2');
  await page.screenshot({path:info.outputPath('mobile-game.png')});
  await page.getByRole('button',{name:'Обычный экран',exact:true}).click();
  await context.setOffline(true);await action('Груз');await expect(frame.locator('#status')).toHaveText('Победа');await context.setOffline(false);
  await page.getByRole('button',{name:'Игры',exact:true}).click();await expect(page.locator('iframe')).toHaveCount(0);
  const first=page.locator('#games button').first();
  let reads=0;page.on('request',r=>{if(/\/api\/versions\/[^/]+$/.test(new URL(r.url()).pathname))reads++;});
  for(let i=0;i<6;i++){await first.click();await expect(page.locator('iframe')).toHaveCount(1);await expect(frame.getByRole('button',{name:'Старт',exact:true})).toBeVisible();await page.getByRole('button',{name:'Игры',exact:true}).click();await expect(page.locator('iframe')).toHaveCount(0);}
  expect(reads).toBe(0);expect(errors).toEqual([]);
});

test('generation cancellation, terminal errors, draft and offline diagnostics never leave a busy spinner', async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Создать',exact:true}).click();
  await page.locator('#prompt').fill('Мой сохранённый черновик');
  await page.route('**/api/games',async route=>{if(route.request().method()==='POST'){await new Promise(done=>setTimeout(done,1500));await route.fulfill({status:504,contentType:'application/json',body:JSON.stringify({error:'LLM_TIMEOUT'})}).catch(()=>{});}else await route.continue();});
  await page.locator('#mode').selectOption('live');await page.getByRole('button',{name:'Создать игру',exact:true}).click();
  await expect(page.locator('#cancel')).toBeVisible();await page.locator('#cancel').click();
  await expect(page.locator('#message')).toContainText('Ожидание отменено');await expect(page.locator('#generate')).toBeEnabled();await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button',{name:'Создать игру',exact:true}).click();await expect(page.locator('#message')).toContainText('не ответила вовремя');await expect(page.locator('#generate')).toBeEnabled();
  await page.reload();await expect(page.locator('#prompt')).toHaveValue('Мой сохранённый черновик');
  await page.route('**/api/games',route=>route.abort());await page.reload();await expect(page.locator('#message')).toContainText('Сервер недоступен');
  await expect(page.locator('#generate')).toBeEnabled();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


test('version and replay controls stay disabled until the displayed game finishes loading', async({page})=>{
  let release!:()=>void;const paused=new Promise<void>(done=>release=done);
  await page.route('**/analytics',async route=>{await paused;await route.continue();});
  try{
    await page.goto('/');await page.getByRole('button',{name:'Создать',exact:true}).click();
    await page.locator('#prompt').fill('Собери 3 груза');await page.getByRole('button',{name:'Создать игру',exact:true}).click();
    await expect(page.frameLocator('#game iframe').getByRole('button',{name:'Старт',exact:true})).toBeVisible();
    await expect(page.locator('#versions')).toBeDisabled();await expect(page.locator('#replay')).toBeDisabled();
    release();await expect(page.locator('#message')).toContainText('Игра сохранена');
    await expect(page.locator('#versions')).toBeEnabled();await expect(page.locator('#replay')).toBeEnabled();
  }finally{release();}
});
