import {test,expect} from '@playwright/test';
import type {BrowserContext,Page} from '@playwright/test';
import {fork} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {PNG} from 'pngjs';
import jsQR from 'jsqr';
import {lanAddresses} from '../src/network.ts';

async function backend(path:string,emptyLibrary=false){
  const child=fork('tests/arena-server.ts',[],{env:{...process.env,YAPLIX_ARENA_TEST_DB:path,YAPLIX_ARENA_TEST_EMPTY:emptyLibrary?'1':'0'},stdio:['ignore','pipe','pipe','ipc']});
  let errors='';child.stderr?.on('data',data=>{errors+=data;});
  const origin=await new Promise<string>((done,fail)=>{const timer=setTimeout(()=>fail(new Error('Arena fixture startup timeout: '+errors)),10000);child.once('message',message=>{clearTimeout(timer);done((message as {origin:string}).origin);});child.once('exit',code=>{clearTimeout(timer);fail(new Error('Arena fixture exit '+code+': '+errors));});});
  return {child,origin};
}
async function stop(child:ChildProcess){if(child.exitCode!==null)return;await new Promise<void>((done,fail)=>{const timer=setTimeout(()=>fail(new Error('Arena fixture shutdown timeout')),8000);child.once('exit',()=>{clearTimeout(timer);done();});child.send('shutdown');});}
async function openSavedGame(page:Page,origin:string){
  const fixture=await(await page.request.get(origin+'/__test/arena-fixtures')).json() as {arenaVersionId:string};
  await page.goto(origin);await page.getByRole('button',{name:'Игры',exact:true}).click();
  await page.locator(`#games button[data-version="${fixture.arenaVersionId}"]`).click();
  await expect(page.locator('#game iframe')).toHaveCount(1);
  const id=new URL(page.url()).searchParams.get('version')!;
  await page.getByRole('button',{name:'Общий рейтинг',exact:true}).click();
  await expect(page.locator('#arena')).toBeVisible();
  // The library action opens the Arena section; the dedicated host page owns
  // room selection, QR presentation and resume controls.
  await page.goto(origin+'/arena?versionId='+encodeURIComponent(id));
  await expect(page.locator('#setup')).toBeVisible();await page.locator('#start').click();
  await expect(page.locator('#qr')).toBeVisible();const url=await page.locator('#url').inputValue();
  return {url,id};
}
async function join(page:Page,url:string,nickname:string){await page.goto(url);await expect(page.locator('#join')).toBeVisible();await page.locator('#nickname').fill(nickname);await page.locator('#join button').click();await expect(page.locator('#play')).toBeVisible({timeout:10_000});}
const attemptAcknowledged=new WeakMap<Page,number>();
async function startAttempt(page:Page){
  // Respect the public one-second attempt limit from the previous acknowledgement.
  // Fast browsers can finish all five real throws before this window expires.
  const remaining=1000-(Date.now()-(attemptAcknowledged.get(page)??0));
  if(remaining>0)await page.waitForTimeout(remaining);
  await page.locator('#attempt').click();
  await expect(page.locator('#attempt-status')).toContainText('Игра подключена');
  attemptAcknowledged.set(page,Date.now());
}
async function play(page:Page,hits:number,touch=true){
  await startAttempt(page);const frame=page.locator('#game iframe');await frame.scrollIntoViewIfNeeded();const canvas=page.frameLocator('#game iframe').locator('canvas');await expect(canvas).toBeVisible();await expect.poll(async()=>{const box=await frame.boundingBox(),rect=await canvas.evaluate(c=>{const r=c.getBoundingClientRect();return{width:r.width,height:r.height};});return Boolean(box&&Math.abs(box.width-rect.width)<1&&Math.abs(box.height-rect.height)<1);},{timeout:5000}).toBe(true);
  // Wait for both the outer iframe and inner canvas to stop moving after viewport rotation.
  await expect.poll(async()=>{await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));const a=await frame.boundingBox();await page.waitForTimeout(80);const b=await frame.boundingBox();return Boolean(a&&b&&Math.abs(a.x-b.x)<.5&&Math.abs(a.y-b.y)<.5&&Math.abs(a.width-b.width)<.5&&Math.abs(a.height-b.height)<.5);},{timeout:5000}).toBe(true);
  await expect(page.locator('#attempt-status')).toContainText('Игра подключена');
  const press=async(x:number,y:number)=>{const box=(await canvas.boundingBox())!;if(touch)await page.touchscreen.tap(box.x+box.width*x,box.y+box.height*y);else await page.mouse.click(box.x+box.width*x,box.y+box.height*y);await canvas.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));};
  await canvas.scrollIntoViewIfNeeded();await press(.5,.62);
  const targets=[[.5,.44],[.25,.35],[.74,.53],[.32,.59],[.68,.30]];
  for(let i=0;i<5;i++)await press(i<hits?targets[i][0]:.04,i<hits?targets[i][1]:.20);
  await expect(page.locator('#attempt-status')).toContainText('Завершённый результат сохранён');
}

test('Arena vertical scenario: one decoded QR, ten independent real games, retry, records and process restart',async({page,browser},info)=>{
  test.skip(!lanAddresses().length,'Private IPv4 required for actual LAN QR; no loopback QR bypass.');
  test.skip(info.project.name!=='chromium-desktop','Ten-client process-restart scenario runs once; responsive gameplay is separate.');test.setTimeout(90000);
  const dir=mkdtempSync('.local/arena-e2e-'),path=resolve(dir,'arena.sqlite');let server=await backend(path);const contexts:BrowserContext[]=[];const errors:string[]=[];
  try{
    const {url,id}=await openSavedGame(page,server.origin);
    const png=PNG.sync.read(await page.locator('#qr').screenshot());
    const decoded=(jsQR as unknown as (d:Uint8ClampedArray,w:number,h:number)=>{data:string}|null)(new Uint8ClampedArray(png.data),png.width,png.height);expect(decoded?.data).toBe(url);
    const requests:string[]=[];
    const clients=await Promise.all(Array.from({length:10},async(_,i)=>{const context=await browser.newContext({viewport:{width:i%2?390:320,height:760},hasTouch:true,isMobile:true});contexts.push(context);const client=await context.newPage();client.on('pageerror',e=>errors.push(e.message));client.on('request',r=>requests.push(r.url()));await join(client,url,'Участник '+i);return client;}));
    const cookies=await Promise.all(contexts.map(c=>c.cookies()));expect(new Set(cookies.map(c=>c.find(v=>v.name==='yaplix_arena')!.value)).size).toBe(10);
    // Concurrent attempts, real PointerEvent gameplay inside the opaque iframe, no score injection.
    await Promise.all(clients.map((client,i)=>play(client,i%6)));
    for(const client of clients)expect(await client.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts');
    await expect(page.locator('#scores tr')).toHaveCount(10);
    await expect(page.locator('#scores tr').filter({hasText:'Участник 5'})).toContainText('150');
    await expect(page.locator('#scores tr').filter({hasText:'Участник 0'})).toContainText('0');
    // A worse completed attempt preserves a record; a better one replaces it.
    await play(clients[4],1);await expect(clients[4].locator('#scores tr').filter({hasText:'Участник 4'})).toContainText('120');
    await play(clients[0],2);await expect.poll(async()=>{
      const row=await page.locator('#scores tr').filter({hasText:'Участник 0'}).innerText();
      return Number(row.trim().split(/\s+/).at(-1));
    }).toBeGreaterThan(0);
    const previousBest=Number((await page.locator('#scores tr').filter({hasText:'Участник 0'}).innerText()).trim().split(/\s+/).at(-1));
    // Failed transport retains the exact final event, then replays it idempotently.
    let failEnd=true;
    await clients[0].route('**/events',route=>{if(failEnd&&route.request().postDataJSON().type==='session_ended'){failEnd=false;return route.abort();}return route.continue();});
    await startAttempt(clients[0]);const canvas=clients[0].frameLocator('#game iframe').locator('canvas');await expect(clients[0].locator('#attempt-status')).toContainText('Игра подключена');await canvas.scrollIntoViewIfNeeded();
    const box=(await canvas.boundingBox())!;await clients[0].touchscreen.tap(box.x+box.width*.5,box.y+box.height*.62);
    for(const [x,y] of [[.5,.44],[.25,.35],[.74,.53],[.32,.59],[.68,.30]])await clients[0].touchscreen.tap(box.x+box.width*x,box.y+box.height*y);
    await expect(clients[0].locator('#retry-event')).toBeVisible();
    await expect.poll(async()=>Number((await page.locator('#scores tr').filter({hasText:'Участник 0'}).innerText()).trim().split(/\s+/).at(-1))).toBe(previousBest);
    await clients[0].locator('#retry-event').click();await expect(clients[0].locator('#attempt-status')).toContainText('Завершённый результат сохранён');
    await expect.poll(async()=>Number((await page.locator('#scores tr').filter({hasText:'Участник 0'}).innerText()).trim().split(/\s+/).at(-1))).toBeGreaterThan(previousBest);
    const retriedBest=Number((await page.locator('#scores tr').filter({hasText:'Участник 0'}).innerText()).trim().split(/\s+/).at(-1));
    await page.locator('#screen').click();await expect.poll(()=>page.evaluate(()=>document.fullscreenElement?.id)).toBe('leaderboard');
    await page.locator('#screen').click();await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===null)).toBe(true);
    await page.screenshot({path:info.outputPath('arena-host.png'),fullPage:true});await clients[0].screenshot({path:info.outputPath('arena-player-320.png'),fullPage:true});
    expect(requests.every(r=>!r.includes(new URL(url).hash.slice(1)))).toBe(true);
    const roomId=new URL(url).pathname.split('/').at(-1)!;
    for(const client of clients)await client.close();await stop(server.child);server=await backend(path);
    await page.goto(server.origin+'/arena?versionId='+id);await expect(page.locator('#rooms option')).toHaveCount(2);await page.locator('#rooms').selectOption(roomId);await expect.poll(async()=>Number((await page.locator('#scores tr').filter({hasText:'Участник 0'}).innerText()).trim().split(/\s+/).at(-1))).toBe(retriedBest);
    await page.locator('#start').click();await expect(page.locator('#qr')).toBeVisible();const fresh=await page.locator('#url').inputValue();expect(fresh).not.toBe(url);
    // Returning participant keeps a personal cookie after restart/resume, not another player's identity.
    const returning=await clients[0].context().newPage();await returning.goto(fresh);await expect(returning.locator('#identity')).toHaveText('Участник 0');
    await expect(returning.locator('#scores tr')).toHaveCount(10);await page.locator('#stop').click();await expect(page.locator('#invite')).toBeHidden();await expect(page.locator('#scores tr')).toHaveCount(10);
    expect(errors).toEqual([]);
  }finally{await Promise.all(contexts.map(c=>c.close()));await stop(server.child);rmSync(dir,{recursive:true});}
});

test('Arena room status explains an empty library without requesting an empty versionId',async({page})=>{
  const dir=mkdtempSync('.local/arena-empty-'),server=await backend(resolve(dir,'arena.sqlite'),true);
  const emptyRequests:string[]=[];
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/arena'&&url.searchParams.has('versionId')&&!url.searchParams.get('versionId'))emptyRequests.push(url.href);});
  try{
    await page.goto(server.origin);
    for(const viewport of [
      {width:320,height:700},{width:360,height:700},{width:390,height:780},
      {width:430,height:700},{width:768,height:1024},{width:1440,height:900},
    ]){
      await page.setViewportSize(viewport);
      await page.getByRole('button',{name:'Арена',exact:true}).click();
      await page.getByRole('button',{name:'Комната и QR',exact:true}).click();
      await expect(page.locator('#arena-status')).toHaveText('Сначала откройте игру в библиотеке.');
      await expect.poll(()=>page.locator('#arena-status').evaluate(element=>{
        const rect=element.getBoundingClientRect(),hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
        return Boolean(hit&&(hit===element||element.contains(hit)));
      })).toBe(true);
      await page.getByRole('button',{name:'Обновить статус',exact:true}).click();
      await expect(page.locator('#arena-status')).toHaveText('Сначала откройте игру в библиотеке.');
    }
    expect(emptyRequests).toEqual([]);
  }finally{await stop(server.child);rmSync(dir,{recursive:true});}
});

test('Arena responsive touch or keyboard game, no fabricated score, version isolation and unsupported game',async({page,browser,isMobile},info)=>{
  test.skip(!lanAddresses().length,'Private IPv4 required for actual LAN QR; no loopback QR bypass.');
  test.setTimeout(45000);const dir=mkdtempSync('.local/arena-layout-'),path=resolve(dir,'arena.sqlite');const server=await backend(path);const context=await browser.newContext({...info.project.use,baseURL:undefined});
  try{
    const {url,id}=await openSavedGame(page,server.origin);const client=await context.newPage();await join(client,url,'Длинный_ник_участника_24');
    for(const view of [page,client])expect(await view.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await startAttempt(client);await expect(client.locator('#attempt-status')).toContainText('Игра подключена');
    await expect(page.locator('#scores tr')).toContainText('Нет завершённой партии');
    if(isMobile){const original=client.viewportSize()!;await client.setViewportSize({width:original.height,height:original.width});expect(await client.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await client.setViewportSize(original);}
    // Restarting outer attempt abandons only this client's unfinished round.
    await page.waitForTimeout(1100);await play(client,3,isMobile);
    await expect(page.locator('#scores tr')).toContainText('90');
    if(!isMobile){await startAttempt(client);await expect(client.locator('#attempt-status')).toContainText('Игра подключена');await client.frameLocator('#game iframe').locator('canvas').click({position:{x:10,y:10}});await client.keyboard.press('Enter');await client.keyboard.press('Space');for(let i=0;i<4;i++)await client.keyboard.press('Space');await expect(client.locator('#attempt-status')).toContainText('Завершённый результат сохранён');}
    await client.screenshot({path:info.outputPath('arena-responsive.png'),fullPage:true});
    const version=await(await page.request.get(server.origin+'/api/versions/'+id)).json();expect(version.html).toContain('yaplix-arena');
    expect((await page.request.post(server.origin+'/api/games',{data:{mode:'demo',spec:{...version.spec,prompt:'Ж'.repeat(500)}}})).status()).toBe(404);
    const unsupported=(await(await page.request.get(server.origin+'/__test/arena-fixtures')).json() as {unsupportedVersionId:string}).unsupportedVersionId;
    await page.goto(server.origin+'/arena?versionId='+unsupported);await expect(page.locator('#status')).toContainText('Рейтинг недоступен');await expect(page.locator('#setup')).toBeHidden();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }finally{await context.close();await stop(server.child);rmSync(dir,{recursive:true});}
});
