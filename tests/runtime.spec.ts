import { test, expect } from '@playwright/test';

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
