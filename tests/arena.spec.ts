import {test,expect} from '@playwright/test';
import type {BrowserContext,Page} from '@playwright/test';
import {fork} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {spec,artifact as currentFixture} from './helpers.ts';
import {metricGame} from './arena-metric-fixture.ts';
import {placement,path as mazePath} from './arcade-input.ts';
const artifact={...currentFixture,html:currentFixture.html.replace('<meta name="yaplix-arena" content="score-v1">','')};
import {PNG} from 'pngjs';
import jsQR from 'jsqr';
import {lanAddresses} from '../src/network.ts';

test('every saved game offers Arena preparation, preserves original HTML and requires explicit LLM consent',async({page},info)=>{
  test.skip(!lanAddresses().length,'Private IPv4 required; no loopback bypass.');
  const dir=mkdtempSync('.local/arena-prepare-'),server=await backend(resolve(dir,'arena.sqlite'));
  try{
    const html=readFileSync('assets/games/ember-blocks.html','utf8');
    const old=await(await page.request.post(server.origin+'/api/games',{data:{spec,artifact:{...artifact,html}}})).json();
    await page.goto(server.origin+'/?game='+old.gameId+'&version='+old.versionId);await page.locator('#arena-game').click();
    await expect(page.locator('#prepare-local')).toBeVisible();await page.locator('#prepare-local').click();
    await expect(page.locator('#setup')).toBeVisible();expect(new URL(page.url()).searchParams.get('versionId')).not.toBe(old.versionId);
    const history=await(await page.request.get(server.origin+'/api/games/'+old.gameId)).json();expect(history.versions).toHaveLength(2);
    expect((await(await page.request.get(server.origin+'/api/versions/'+old.versionId)).json()).html).toBe(html);
    const unknown=await(await page.request.post(server.origin+'/api/games',{data:{spec,artifact}})).json();
    let calls=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/arena/prepare'))calls++;});
    await page.goto(server.origin+'/arena?versionId='+unknown.versionId);
    await expect(page.locator('#prepare')).toBeVisible();await expect(page.locator('#prepare-llm')).toBeDisabled();
    await page.locator('#arena-goal').fill('Пройти головоломку за минимальное время');await expect(page.locator('#prepare-llm')).toBeDisabled();
    await page.locator('#prepare-consent').check();await expect(page.locator('#prepare-llm')).toBeEnabled();expect(calls).toBe(0);
    await expect(page.locator('#setup')).toBeHidden();await expect(page.locator('#leaderboard')).toBeHidden();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath('arena-preparation.png'),fullPage:true});
  }finally{await stop(server.child);rmSync(dir,{recursive:true});}
});

async function backend(path:string,synthetic=false){
  const child=fork('tests/arena-server.ts',[],{env:{...process.env,YAPLIX_ARENA_TEST_DB:path,YAPLIX_ARENA_SYNTHETIC:synthetic?'1':'0'},stdio:['ignore','pipe','pipe','ipc']});
  let errors='';child.stderr?.on('data',data=>{errors+=data;});
  const origin=await new Promise<string>((done,fail)=>{const timer=setTimeout(()=>fail(new Error('Arena fixture startup timeout: '+errors)),10000);child.once('message',message=>{clearTimeout(timer);done((message as {origin:string}).origin);});child.once('exit',code=>{clearTimeout(timer);fail(new Error('Arena fixture exit '+code+': '+errors));});});
  return {child,origin};
}
async function stop(child:ChildProcess){if(child.exitCode!==null)return;await new Promise<void>((done,fail)=>{const timer=setTimeout(()=>fail(new Error('Arena fixture shutdown timeout')),8000);child.once('exit',()=>{clearTimeout(timer);done();});child.send('shutdown');});}
async function openDemo(page:Page,origin:string){
  await page.goto(origin);await page.getByRole('button',{name:'Игры',exact:true}).click();
  await page.getByRole('button',{name:'Arena: Меткий бросок · офлайн',exact:true}).click();
  await expect(page.locator('#game iframe')).toHaveCount(1);
  const id=new URL(page.url()).searchParams.get('version')!;
  await page.getByRole('button',{name:'Общий рейтинг',exact:true}).click();
  await expect(page.locator('#setup')).toBeVisible();await page.locator('#start').click();
  await expect(page.locator('#qr')).toBeVisible();const url=await page.locator('#url').inputValue();
  return {url,id};
}
async function join(page:Page,url:string,nickname:string){await page.goto(url);await expect(page.locator('#join')).toBeVisible();await page.locator('#nickname').fill(nickname);await page.locator('#join button').click();await expect(page.locator('#play')).toBeVisible({timeout:12000});}
async function gates(page:Page,delay=0){
  await page.locator('#attempt').click();await expect(page.locator('#attempt-status')).toContainText('Игра подключена');
  const canvas=page.frameLocator('#game iframe').locator('canvas');await canvas.click({position:{x:20,y:20}});
  if(delay)await page.waitForTimeout(delay);
  const box=(await canvas.boundingBox())!;
  for(const x of [.2,.8,.2])await canvas.click({position:{x:box.width*x,y:box.height*.5}});
  await expect(page.locator('#attempt-status')).toContainText('Завершённый результат сохранён');
}

for(const title of ['Искры в клетках','Световой лабиринт'])test('authored gallery real Arena score: '+title,async({page,browser},info)=>{
  test.skip(!lanAddresses().length,'Private IPv4 required; no loopback bypass.');test.setTimeout(45000);
  const dir=mkdtempSync('.local/arena-authored-'),server=await backend(resolve(dir,'arena.sqlite')),context=await browser.newContext({...info.project.use,baseURL:undefined});
  try{
    await page.goto(server.origin);await page.getByRole('button',{name:'Игры',exact:true}).click();await page.getByRole('button',{name:title+' · офлайн',exact:true}).click();await page.locator('#arena-game').click();await expect(page.locator('#setup')).toBeVisible();await page.locator('#start').click();await expect(page.locator('#qr')).toBeVisible();
    const client=await context.newPage();await join(client,await page.locator('#url').inputValue(),'Реальная партия');await client.locator('#attempt').click();await expect(client.locator('#attempt-status')).toContainText('Игра подключена');
    const game=client.frameLocator('#game iframe');await game.locator('#start').click();const state=async()=>JSON.parse((await game.locator('output').textContent())!);
    if(title==='Искры в клетках'){
      for(let i=0;i<120;i++){const current=await state();if(current.phase!=='playing')break;const plan=placement(current.board,current.piece.matrix);await game.locator('body').evaluate((_,plan)=>{const click=(id:string)=>(document.querySelector('#'+id) as HTMLButtonElement).click();for(let i=0;i<plan.turns;i++)click('rotate');const read=()=>JSON.parse(document.querySelector('output')!.textContent!);for(let i=0;i<12&&read().piece.x!==plan.x;i++)click(read().piece.x<plan.x?'right':'left');click('drop');},plan);}
      expect((await state()).score).toBeGreaterThanOrEqual(600);expect((await state()).phase).toBe('won');
    }else{
      for(let i=0;i<6;i++){const current=await state(),options=current.coins.map((coin:any)=>mazePath(current.walls,current.player,coin,current.enemies)).filter(Boolean).sort((a:any,b:any)=>a.length-b.length);expect(options.length).toBeGreaterThan(0);await game.locator('body').evaluate((_,keys)=>{for(const key of keys as string[])dispatchEvent(new KeyboardEvent('keydown',{key}));},options[0]);}
      const current=await state(),keys=mazePath(current.walls,current.player,current.exit,current.enemies);expect(keys).not.toBeNull();await game.locator('body').evaluate((_,keys)=>{for(const key of keys!)dispatchEvent(new KeyboardEvent('keydown',{key}));},keys);expect((await state()).phase).toBe('won');
    }
    const final=(await state()).score;await expect(client.locator('#attempt-status')).toContainText('Завершённый результат сохранён');await expect(page.locator('#scores tr')).toContainText(String(final));
    await client.screenshot({path:info.outputPath('authored-arena.png'),fullPage:true});
  }finally{await context.close();await stop(server.child);rmSync(dir,{recursive:true});}
});

for(const metric of ['score','completion-time','distance','survival'])test('universal Arena real input: '+metric,async({page,browser},info)=>{
  test.skip(!lanAddresses().length,'Private IPv4 required; no loopback bypass.');
  const dir=mkdtempSync('.local/arena-metric-'),server=await backend(resolve(dir,'arena.sqlite')),context=await browser.newContext({...info.project.use,baseURL:undefined});
  try{
    const v=await(await page.request.post(server.origin+'/api/games',{data:{spec,artifact:{...artifact,html:metricGame(metric)}}})).json();
    await page.goto(server.origin+'/arena?versionId='+v.versionId);await expect(page.locator('#setup')).toBeVisible();await page.locator('#start').click();await expect(page.locator('#qr')).toBeVisible();
    const url=await page.locator('#url').inputValue(),client=await context.newPage();await join(client,url,'Первый');await gates(client,metric==='completion-time'?350:30);
    const first=await(await client.request.get(new URL(url).origin+new URL(url).pathname+'/results')).json();
    expect(first.metric.id).toBe(metric);expect(first.players[0].bestScore).toBeGreaterThan(0);
    if(metric==='score'||metric==='distance')expect(first.players[0].bestScore).toBe(30);
    const base=new URL(url).origin+new URL(url).pathname;
    expect((await page.request.post(base+'/events',{headers:{Origin:new URL(url).origin},data:{value:999}})).status()).toBe(401);
    await page.waitForTimeout(1100);await gates(client,metric==='completion-time'?100:50);
    const last=await(await client.request.get(base+'/results')).json();
    if(metric==='completion-time')expect(last.players[0].bestScore).toBeLessThan(first.players[0].bestScore);
    else expect(last.players[0].bestScore).toBeGreaterThanOrEqual(first.players[0].bestScore);
    expect(await client.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts');
    await page.goto(server.origin+'/?game='+v.gameId+'&version='+v.versionId);
    if(metric==='completion-time'||metric==='survival')await expect(page.locator('#analytics')).toContainText(/Средний результат.*\d+\.\d{3} с/);
    if(metric==='distance')await expect(page.locator('#analytics')).toContainText('Средний результат · Дистанция: 30 м');
  }finally{await context.close();await stop(server.child);rmSync(dir,{recursive:true});}
});

test('unknown historical game obtains a separate playable Arena version only after consent (synthetic transport)',async({page,browser},info)=>{
  test.skip(info.project.name!=='chromium-desktop','Durable synthetic preparation and production checker run once; preparation UI runs on all profiles.');
  test.skip(!lanAddresses().length,'Private IPv4 required; no loopback bypass.');test.setTimeout(45000);
  const dir=mkdtempSync('.local/arena-adapt-'),server=await backend(resolve(dir,'arena.sqlite'),true),context=await browser.newContext();
  try{
    const html=metricGame('score',false),old=await(await page.request.post(server.origin+'/api/games',{data:{spec,artifact:{...artifact,html}}})).json();
    await page.goto(server.origin+'/arena?versionId='+old.versionId);await page.locator('#arena-goal').fill('Соревноваться по числу реально пройденных ворот гонки');
    expect((await(await page.request.get(server.origin+'/fixture-stats')).json()).calls).toBe(0);
    await page.locator('#prepare-consent').check();const sent=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/api/arena/prepare'));await page.locator('#prepare-llm').click();const requestBody=(await sent).postDataJSON();
    await expect(page.locator('#setup')).toBeVisible({timeout:30000});
    const newId=new URL(page.url()).searchParams.get('versionId');expect(newId).not.toBe(old.versionId);
    expect((await(await page.request.get(server.origin+'/fixture-stats')).json()).calls).toBe(1);
    const duplicate=await page.request.post(server.origin+'/api/arena/prepare',{data:requestBody});expect(duplicate.status()).toBe(202);expect((await(await page.request.get(server.origin+'/fixture-stats')).json()).calls).toBe(1);
    const history=await(await page.request.get(server.origin+'/api/games/'+old.gameId)).json();expect(history.versions).toHaveLength(2);
    expect((await(await page.request.get(server.origin+'/api/versions/'+old.versionId)).json()).html).toBe(html);
    await page.locator('#start').click();await expect(page.locator('#qr')).toBeVisible();const client=await context.newPage();await join(client,await page.locator('#url').inputValue(),'Новая версия');await gates(client);
    await expect(page.locator('#scores tr')).toContainText('30');
  }finally{await context.close();await stop(server.child);rmSync(dir,{recursive:true});}
});
async function play(page:Page,hits:number,touch=true){
  await page.locator('#attempt').click();const canvas=page.frameLocator('#game iframe').locator('canvas');await expect(canvas).toBeVisible();
  await expect(page.locator('#attempt-status')).toContainText('Игра подключена');
  const press=async(x:number,y:number)=>{const box=(await canvas.boundingBox())!;if(touch)await page.touchscreen.tap(box.x+box.width*x,box.y+box.height*y);else await page.mouse.click(box.x+box.width*x,box.y+box.height*y);};
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
    const {url,id}=await openDemo(page,server.origin);
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
    await play(clients[0],2);await expect(page.locator('#scores tr').filter({hasText:'Участник 0'})).toContainText('60');
    // Failed transport retains the exact final event, then replays it idempotently.
    let failEnd=true;
    await clients[0].route('**/events',route=>{if(failEnd&&route.request().postDataJSON().type==='session_ended'){failEnd=false;return route.abort();}return route.continue();});
    await clients[0].locator('#attempt').click();const canvas=clients[0].frameLocator('#game iframe').locator('canvas');await expect(clients[0].locator('#attempt-status')).toContainText('Игра подключена');await canvas.scrollIntoViewIfNeeded();
    const box=(await canvas.boundingBox())!;await clients[0].touchscreen.tap(box.x+box.width*.5,box.y+box.height*.62);
    for(const [x,y] of [[.5,.44],[.25,.35],[.74,.53],[.32,.59],[.68,.30]])await clients[0].touchscreen.tap(box.x+box.width*x,box.y+box.height*y);
    await expect(clients[0].locator('#retry-event')).toBeVisible();await expect(page.locator('#scores tr').filter({hasText:'Участник 0'})).toContainText('60');
    await clients[0].locator('#retry-event').click();await expect(clients[0].locator('#attempt-status')).toContainText('Завершённый результат сохранён');
    await expect(page.locator('#scores tr').filter({hasText:'Участник 0'})).toContainText('150');
    await page.locator('#screen').click();await expect.poll(()=>page.evaluate(()=>document.fullscreenElement?.id)).toBe('leaderboard');
    await page.locator('#screen').click();await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===null)).toBe(true);
    await page.screenshot({path:info.outputPath('arena-host.png'),fullPage:true});await clients[0].screenshot({path:info.outputPath('arena-player-320.png'),fullPage:true});
    expect(requests.every(r=>!r.includes(new URL(url).hash.slice(1)))).toBe(true);
    const roomId=new URL(url).pathname.split('/').at(-1)!;
    for(const client of clients)await client.close();await stop(server.child);server=await backend(path);
    await page.goto(server.origin+'/arena?versionId='+id);await expect(page.locator('#rooms option')).toHaveCount(2);await page.locator('#rooms').selectOption(roomId);await expect(page.locator('#scores tr').filter({hasText:'Участник 0'})).toContainText('150');
    await page.locator('#start').click();await expect(page.locator('#qr')).toBeVisible();const fresh=await page.locator('#url').inputValue();expect(fresh).not.toBe(url);
    // Returning participant keeps a personal cookie after restart/resume, not another player's identity.
    const returning=await clients[0].context().newPage();await returning.goto(fresh);await expect(returning.locator('#identity')).toHaveText('Участник 0');
    await expect(returning.locator('#scores tr')).toHaveCount(10);await page.locator('#stop').click();await expect(page.locator('#invite')).toBeHidden();await expect(page.locator('#scores tr')).toHaveCount(10);
    expect(errors).toEqual([]);
  }finally{await Promise.all(contexts.map(c=>c.close()));await stop(server.child);rmSync(dir,{recursive:true});}
});

test('Arena responsive touch or keyboard game, no fabricated score, version isolation and unsupported game',async({page,browser,isMobile},info)=>{
  test.skip(!lanAddresses().length,'Private IPv4 required for actual LAN QR; no loopback QR bypass.');
  test.setTimeout(45000);const dir=mkdtempSync('.local/arena-layout-'),path=resolve(dir,'arena.sqlite');const server=await backend(path);const context=await browser.newContext({...info.project.use,baseURL:undefined});
  try{
    const {url,id}=await openDemo(page,server.origin);const client=await context.newPage();await join(client,url,'Длинный_ник_участника_24');
    for(const view of [page,client])expect(await view.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await client.locator('#attempt').click();await expect(client.locator('#attempt-status')).toContainText('Игра подключена');
    await expect(page.locator('#scores tr')).toContainText('Нет завершённой партии');
    if(isMobile){const original=client.viewportSize()!;await client.setViewportSize({width:original.height,height:original.width});expect(await client.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await client.setViewportSize(original);}
    // Restarting outer attempt abandons only this client's unfinished round.
    await page.waitForTimeout(1100);await play(client,3,isMobile);
    await expect(page.locator('#scores tr')).toContainText('90');
    if(!isMobile){await page.waitForTimeout(1100);await client.locator('#attempt').click();await expect(client.locator('#attempt-status')).toContainText('Игра подключена');await client.frameLocator('#game iframe').locator('canvas').click({position:{x:10,y:10}});await client.keyboard.press('Enter');await client.keyboard.press('Space');for(let i=0;i<4;i++)await client.keyboard.press('Space');await expect(client.locator('#attempt-status')).toContainText('Завершённый результат сохранён');}
    await client.screenshot({path:info.outputPath('arena-responsive.png'),fullPage:true});
    const version=await(await page.request.get(server.origin+'/api/versions/'+id)).json();expect(version.html).toContain('yaplix-arena');
    const unsupported=await(await page.request.post(server.origin+'/api/games',{data:{mode:'demo',spec:{...version.spec,prompt:'Ж'.repeat(500)}}})).json();
    await page.goto(server.origin+'/arena?versionId='+unsupported.versionId);await expect(page.locator('#status')).toContainText('Рейтинг недоступен');await expect(page.locator('#setup')).toBeHidden();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }finally{await context.close();await stop(server.child);rmSync(dir,{recursive:true});}
});


test('Arena host keeps Stop available after room selection and a failed refresh',async({page},info)=>{
  test.skip(info.project.name!=='chromium-desktop','Host action lifecycle runs once.');
  test.skip(!lanAddresses().length,'Private IPv4 required; no loopback bypass.');
  const dir=mkdtempSync('.local/arena-controls-'),server=await backend(resolve(dir,'arena.sqlite'));
  try{
    const {url}=await openDemo(page,server.origin),roomId=new URL(url).pathname.split('/').at(-1)!;
    await expect(page.locator('#stop')).toBeEnabled();
    await page.locator('#rooms').selectOption(roomId);
    await expect(page.locator('#refresh')).toBeEnabled();
    await expect(page.locator('#stop')).toBeEnabled();
    await page.route('**/api/arena?versionId=*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'DEMO_REFRESH_FAILURE'})}));
    await page.locator('#refresh').click();
    await expect(page.locator('#status')).toContainText('DEMO_REFRESH_FAILURE');
    await expect(page.locator('#stop')).toBeEnabled();
    await page.locator('#stop').click();
    await expect(page.locator('#stop')).toBeDisabled();
  }finally{await stop(server.child);rmSync(dir,{recursive:true});}
});
