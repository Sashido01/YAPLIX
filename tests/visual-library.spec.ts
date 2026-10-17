import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const names = ['neon-arcade', 'pixel-retro', 'neon-survivor', 'pixel-breaker', 'standalone-example'];
const read = (page: Page, expression: string): Promise<any> => page.evaluate(expression);

test.beforeEach(async ({ page }) => {
  // Only these local assets can load; unexpected external requests fail the test.
  const failures: string[] = [];
  page.on('pageerror', e => failures.push(e.message));
  page.on('console', m => { if (m.type() === 'error') failures.push(m.text()); });
  page.on('requestfailed', r => failures.push(r.url()));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    const file = url.pathname.slice(1);
    if (url.origin !== 'http://visual-library.test' || ![...names.map(n => n + '.html'), 'effects.js'].includes(file)) {
      failures.push('Unexpected resource: ' + url.href);
      return route.abort();
    }
    await route.fulfill({ body: await readFile(new URL('../assets/visual-library/' + file, import.meta.url)),
      contentType: file.endsWith('.js') ? 'text/javascript' : 'text/html' });
  });
  (page as Page & { visualFailures: string[] }).visualFailures = failures;
});

test.afterEach(async ({ page }) => {
  expect((page as Page & { visualFailures: string[] }).visualFailures).toEqual([]);
});

for (const name of names) test(`${name}: start, keyboard, mouse, touch, resize, canvas`, async ({ page, context, browserName }, info) => {
  await page.goto('http://visual-library.test/' + name + '.html');
  const button = page.locator('#start-btn');
  await expect(button).toBeVisible();
  if (info.project.use.hasTouch) await button.tap(); else await button.click();
  await expect(button).toBeHidden();
  const mover = name === 'pixel-breaker' ? 'paddle' : 'player';
  const x = await read(page, mover + '.x');
  await page.keyboard.down('ArrowLeft');
  await expect.poll(() => read(page, mover + '.x')).toBeLessThan(x);
  await page.keyboard.up('ArrowLeft');
  const left = await read(page, mover + '.x');
  const size = page.viewportSize()!;
  await page.mouse.move(size.width - 25, size.height - 25);
  await page.mouse.down();
  await expect.poll(() => read(page, mover + '.x')).toBeGreaterThan(left);
  await page.mouse.up();
  if (info.project.use.hasTouch) {
    // Held touch via DOM events: browser-emulated handler coverage, not a device claim.
    const receiver = name === 'neon-survivor' ? 'canvas' : '#controls';
    const right = await read(page, mover + '.x');
    if (browserName === 'chromium') {
      const session = await context.newCDPSession(page);
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{x:20,y:size.height-25}] });
      await expect.poll(() => read(page, mover + '.x')).toBeLessThan(right);
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await session.detach();
    } else {
      // WebKit desktop does not expose a constructible Touch. Exercise held-input
      // handlers explicitly; tap START above uses Playwright's native touch path.
      await page.locator(receiver).evaluate((target, height) => {
        const event = new Event('touchstart', {cancelable:true});
        Object.defineProperty(event, 'touches', {value:[{clientX:20,clientY:height-25}]});
        target.dispatchEvent(event);
      }, size.height);
      await expect.poll(() => read(page, mover + '.x')).toBeLessThan(right);
      await page.locator(receiver).evaluate(target => target.dispatchEvent(new Event('touchend', {cancelable:true})));
    }
  }
  if (name !== 'pixel-breaker') {
    await read(page, name === 'neon-survivor'
      ? "collectibles.push({x:player.x,y:player.y,size:12,speed:0,color:'#0f8'})"
      : "targets.push({x:player.x,y:player.y,size:12,speed:0,color:'#fff'})");
    await expect.poll(() => read(page, 'score')).toBeGreaterThan(0);
  }
  await page.screenshot({ path: info.outputPath(name + '-portrait.png') });
  await read(page, 'loop.stop()');
  const before = await read(page, '({score, lives})');
  await page.setViewportSize({ width: size.height, height: size.width });
  await expect.poll(() => read(page, 'getSize().height')).toBe(size.width);
  expect(await read(page, '({score, lives})')).toEqual(before);
  expect(await read(page, `${mover}.x >= 0 && ${mover}.x + ${mover === 'paddle' ? 'paddle.width' : 'player.size'} <= innerWidth && ${mover}.y < innerHeight`)).toBe(true);
  expect(await read(page, 'document.documentElement.scrollWidth <= innerWidth')).toBe(true);
  expect(await read(page, `(() => { const c = document.querySelector('canvas'); return c.width === Math.floor(innerWidth * devicePixelRatio) && c.height === Math.floor(innerHeight * devicePixelRatio); })()`)).toBe(true);
  await read(page, 'loop.start()');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: info.outputPath(name + '-rotated.png') });
});

test('effects.js: complete public API and particle/loop contracts', async ({ page }) => {
  await page.goto('http://visual-library.test/neon-arcade.html');
  expect(await read(page, 'Object.keys(YaplixFx).sort()')).toEqual([
    'Particle', 'PixelParticle', 'clamp', 'clampDelta', 'collides', 'setupCanvas', 'setupLoop', 'setupUnifiedInput', 'spawnExplosion'
  ].sort());
  expect(await read(page, `(() => {
    const f = YaplixFx, p = new f.Particle(1, 2, '#fff', {decay: 1}), q = new f.PixelParticle(1, 2, '#fff', {decay: 1});
    p.update(); q.update(); f.Particle.drawAll(ctx, [p]); f.PixelParticle.drawAll(ctx, [q]);
    const input = f.setupUnifiedInput('missing'); input.input.left = true; input.clearInput();
    return p.dead && q.dead && p.glow === 0 && ctx.globalAlpha === 1 && !input.input.left
      && f.spawnExplosion(0, 0, '#fff', f.Particle).length === 15
      && f.clamp(9, 0, 3) === 3 && f.clampDelta(200) === 100
      && f.collides({x:0,y:0,size:2}, {x:1,y:1,size:2})
      && !f.collides({x:0,y:0,size:2}, {x:4,y:0,size:2});
  })()`)).toBe(true);
  await read(page, 'loop.start(); loop.start()');
  expect(await read(page, 'loop.isRunning()')).toBe(true);
  await read(page, 'loop.stop()');
  expect(await read(page, 'loop.isRunning()')).toBe(false);
});

test('Pixel Breaker: collision → resize preserves progress; win/loss/restart after rotation', async ({ page }) => {
  await page.goto('http://visual-library.test/pixel-breaker.html');
  await page.locator('#start-btn').click();
  await read(page, `loop.stop(); ball.launched = true; ball.vx = 0; ball.vy = -1;
    ball.x = bricks[0].x + bricks[0].width / 2; ball.y = bricks[0].y + bricks[0].height / 2; update(16)`);
  const before = await read(page, '({alive:bricks.map(b => b.alive),score,lives,state,vx:ball.vx,vy:ball.vy})');
  expect(before.alive[0]).toBe(false);
  expect(before.score).toBe(50);
  const size = page.viewportSize()!;
  for (const viewport of [{width:size.height,height:size.width}, {width:320,height:568}, size]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => read(page, 'getSize().width')).toBe(viewport.width);
    expect(await read(page, '({alive:bricks.map(b => b.alive),score,lives,state,vx:ball.vx,vy:ball.vy})')).toEqual(before);
    expect(await read(page, 'paddle.x >= gameOffsetX && paddle.x + paddle.width <= gameOffsetX + gameWidth && ball.y + ball.size < paddle.y')).toBe(true);
  }
  // Exercise actual collision/scoring paths at deterministic ball positions, not endGame().
  await read(page, `for (const brick of bricks) { if (!brick.alive) continue;
    ball.x = brick.x + brick.width / 2; ball.y = brick.y + brick.height / 2;
    ball.vx = 0; ball.vy = -1; update(16); }`);
  expect(await read(page, 'state')).toBe('WON');
  await page.setViewportSize({width:640,height:360});
  await expect.poll(() => read(page, 'getSize().height')).toBe(360);
  expect(await read(page, 'state')).toBe('WON');
  await expect(page.locator('#message')).toContainText('ПОБЕДА');
  await read(page, 'input.left = true');
  await page.locator('#start-btn').click();
  await read(page, 'loop.stop()');
  expect(await read(page, '!input.left && !input.right')).toBe(true);
  expect(await read(page, '({score,lives,state,alive:bricks.every(b=>b.alive),launched:ball.launched,particles:particles.length})'))
    .toEqual({score:0,lives:3,state:'PLAYING',alive:true,launched:false,particles:0});
  await read(page, `for (let i=0;i<3;i++) {ball.launched=true;ball.x=gameOffsetX+ball.size+1;ball.y=getSize().height+ball.size+1;ball.vx=0;ball.vy=1;update(16);}`);
  expect(await read(page, 'state')).toBe('LOST');
  await expect(page.locator('#message')).toContainText('ПОРАЖЕНИЕ');
  await page.setViewportSize(size);
  await expect.poll(() => read(page, 'getSize().width')).toBe(size.width);
  expect(await read(page, 'state')).toBe('LOST');
  await page.locator('#start-btn').click();
  await read(page, 'loop.stop()');
  expect(await read(page, 'score === 0 && lives === 3 && bricks.every(b=>b.alive) && !ball.launched')).toBe(true);
  await page.setViewportSize({width:360,height:640});
  await expect.poll(() => read(page, 'getSize().height')).toBe(640);
  expect(await read(page, 'ball.x === paddle.x + paddle.width / 2 && ball.y === paddle.y - ball.size - 5 && !ball.launched')).toBe(true);
  await read(page, 'paddle.x = -1000; update(16)');
  expect(await read(page, 'paddle.x')).toBe(await read(page, 'gameOffsetX'));
  await read(page, 'paddle.x = 10000; update(16)');
  expect(await read(page, 'paddle.x + paddle.width')).toBe(await read(page, 'gameOffsetX + gameWidth'));
});

test('Neon Survivor: collision win/loss and full restart', async ({ page }) => {
  await page.goto('http://visual-library.test/neon-survivor.html');
  await page.locator('#start-btn').click();
  await read(page, `loop.stop(); for(let i=0;i<10;i++) {collectibles.push({x:player.x,y:player.y,size:12,speed:0,color:'#0f8'});update(0);}`);
  expect(await read(page, 'state')).toBe('WON');
  await page.locator('#start-btn').click();
  await read(page, 'loop.stop()');
  expect(await read(page, 'score === 0 && lives === 3 && enemies.length === 0 && collectibles.length === 0')).toBe(true);
  await read(page, `for(let i=0;i<3;i++) {enemies.push({x:player.x,y:player.y,size:18,speed:0,color:'#f04'});update(0);}`);
  expect(await read(page, 'state')).toBe('LOST');
  await page.locator('#start-btn').click();
  expect(await read(page, 'score === 0 && lives === 3 && state === "PLAYING"')).toBe(true);
});
