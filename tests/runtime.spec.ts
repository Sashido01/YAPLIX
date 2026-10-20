import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

test('exported synthetic HTML starts offline from file, with touch/keyboard and responsive Canvas', async ({ page, context, request, isMobile }, testInfo) => {
  await page.goto('/host');
  const session = await page.evaluate(() => (window as any).testSession);
  const version = await (await request.get(`/api/versions/${session.versionId}`)).json();
  const response = await request.get(`/api/versions/${session.versionId}/export`);
  const bytes = await response.body();
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(version.sha256);
  expect(response.headers()['content-disposition']).toContain('attachment');
  const path = testInfo.outputPath('synthetic-export.html');
  writeFileSync(path, bytes, { flag: 'wx' });
  const errors: string[] = []; const network: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', req => { if (/^https?:/.test(req.url())) network.push(req.url()); });
  try {
    await context.setOffline(true);
    await page.goto(pathToFileURL(resolve(path)).href);
    if (isMobile) {
      await page.getByRole('button', { name: 'Start', exact: true }).tap();
      for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Point', exact: true }).tap();
    } else {
      await page.keyboard.press('Enter');
      for (let i = 0; i < 3; i++) await page.keyboard.press('Space');
    }
    await expect(page.locator('#status')).toHaveText('Won');
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 568 });
      await expect.poll(() => page.locator('canvas').evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(width - 32);
      expect(await page.locator('canvas').evaluate(el => (el as HTMLCanvasElement).width === Math.round(el.getBoundingClientRect().width * devicePixelRatio))).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect(errors).toEqual([]); expect(network).toEqual([]);
  } finally { unlinkSync(path); }
});

test('authored game works offline without parent: win and loss, fitting the viewport', async ({ page, context }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/fixture');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Point', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Won');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.setOffline(false); await page.reload(); await context.setOffline(true);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Trap', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Lost');
  expect(errors).toEqual([]);
});
test('opaque runtime forwards validated events to SQLite and isolates platform state', async ({ page, request }) => {
  await page.goto('/host');
  const frame = page.frameLocator('iframe');
  await expect.poll(() => page.evaluate(() => (window as any).received?.length)).toBe(1);
  expect(await page.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts');
  await frame.getByRole('button', { name: 'Start', exact: true }).click();
  for (let i = 0; i < 3; i++) await frame.getByRole('button', { name: 'Point', exact: true }).click();
  await expect(frame.locator('#status')).toHaveText('Won');
  const session = await page.evaluate(() => (window as any).testSession);
  await expect.poll(async () => (await (await request.get(`/api/versions/${session.versionId}/analytics`)).json()).completedCount).toBe(1);
  const stats = await (await request.get(`/api/versions/${session.versionId}/analytics`)).json();
  expect([stats.won, stats.meanScore]).toEqual([1, 3]);
  expect(await page.evaluate(() => (window as any).forwardErrors)).toEqual([]);
  const inner = page.frames()[1];
  expect(await inner.evaluate(() => { try { return (parent as any).testSession.token; } catch { return 'blocked'; } })).toBe('blocked');
  expect(await inner.evaluate(() => { try { localStorage.setItem('steal', 'x'); return 'allowed'; } catch { return 'blocked'; } })).toBe('blocked');
});
test('CSP blocks fetch, frames and forms; forged messages and game errors leave host alive', async ({ page }) => {
  const network: string[] = []; page.on('request', req => { if (req.url().includes('/blocked-probe')) network.push(req.url()); });
  await page.goto('/host'); await expect.poll(() => page.evaluate(() => (window as any).received?.length)).toBe(1);
  const inner = page.frames()[1];
  expect(await inner.evaluate(async () => { try { await fetch('/blocked-probe'); return 'allowed'; } catch { return 'blocked'; } })).toBe('blocked');
  await inner.evaluate(() => {
    const nested = document.createElement('iframe'); nested.src='http://127.0.0.1:3210/blocked-probe'; document.body.append(nested);
    const form=document.createElement('form'); form.action='http://127.0.0.1:3210/blocked-probe'; document.body.append(form); form.submit();
    parent.postMessage({ channel:'yaplix',event:{protocolVersion:99} },'*');
    setTimeout(()=>{throw new Error('synthetic error')},0);
  });
  await expect.poll(() => page.evaluate(() => (window as any).received?.some((e: any) => e.type==='game_error'))).toBe(true);
  expect(network).toEqual([]);
  const before = await page.evaluate(() => (window as any).received.length);
  await page.evaluate(() => {
    const w=window as any;
    window.dispatchEvent(new MessageEvent('message',{origin:'null',source:window,data:{channel:'yaplix',event:w.received[0]}}));
    w.unmount();
  });
  expect(await page.evaluate(() => (window as any).received.length)).toBe(before);
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('host loads the complete ESM graph, creates a session and initializes gameplay', async ({ page, request }) => {
  const modules = new Map<string, number>(), errors: string[] = [];
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/runtime/')) modules.set(path, response.status());
  });
  page.on('pageerror', error => errors.push(error.message));
  expect((await page.goto('/host'))!.status()).toBe(200);
  await expect.poll(() => page.evaluate(() => (window as any).received?.[0]?.type)).toBe('game_ready');
  const session = await page.evaluate(() => (window as any).testSession);
  expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  expect([...modules].sort()).toEqual([
    ['/runtime/browser-profiles.js', 200], ['/runtime/contracts.js', 200], ['/runtime/generation-limits.js', 200], ['/runtime/runtime.js', 200]
  ]);
  await page.frameLocator('iframe').getByRole('button', { name: 'Start', exact: true }).click();
  await expect.poll(async () => (await (await request.get(`/api/versions/${session.versionId}/analytics`)).json()).startedCount).toBe(1);
  expect(errors).toEqual([]);
});
