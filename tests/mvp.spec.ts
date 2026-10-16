import {createAndOpen} from './ui-jobs-helper.ts';
import { test, expect } from '@playwright/test';
import { unlinkSync, writeFileSync } from 'node:fs';
import { managedPath } from '../src/store.ts';
import { pathToFileURL } from 'node:url';
import {spec} from './helpers.ts';

test('direct game link resolves latest version and preserves original library title',async({page})=>{
  const first=await(await page.request.post('/api/games',{data:{spec:{...spec,prompt:'Original game idea'},mode:'demo'}})).json();
  const latest=await(await page.request.post('/api/games/'+first.gameId+'/versions',{data:{spec:{...spec,prompt:'Repair instructions for the next version'},mode:'demo',previousVersionId:first.versionId}})).json();
  await page.goto('/?game='+first.gameId);await expect(page.locator('#export')).toHaveAttribute('href','/api/versions/'+latest.versionId+'/export');await expect(page.locator('#game-title')).toHaveText('Original game idea');await expect(page.frameLocator('#game iframe').getByRole('button',{name:'Старт',exact:true})).toBeVisible();
});

test('user creates DEMO, wins, changes goal, selects old version, exports and backs up', async ({ page, browser }, testInfo) => {
  // Two versions, independent offline browser, backup and reload are separate
  // operations; per-assertion waits remain bounded at the normal five seconds.
  test.setTimeout(45000);
  await page.goto('/'); await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await createAndOpen(page);
  await expect(page.locator('#message')).toHaveText('Игра сохранена. Можно играть.');
  const game = page.frameLocator('#game iframe');
  await game.getByRole('button', { name: 'Старт', exact: true }).click();
  for (let i = 0; i < 3; i++) await game.getByRole('button', { name: 'Вправо', exact: true }).click();
  await expect(game.locator('#status')).toHaveText('Победа');
  await expect(page.locator('#analytics')).toContainText('Победы: 1');
  await page.locator('#change').fill('Теперь собери 5 грузов');
  await createAndOpen(page,'Создать следующую версию');
  await expect(page.locator('#message')).toContainText('Новая версия сохранена');
  await game.getByRole('button', { name: 'Старт', exact: true }).click();
  for (let i = 0; i < 3; i++) await game.getByRole('button', { name: 'Вправо', exact: true }).click();
  await expect(game.locator('#status')).toHaveText('В полёте');
  for (let i = 0; i < 2; i++) await game.getByRole('button', { name: 'Вправо', exact: true }).click();
  await expect(game.locator('#status')).toHaveText('Победа');
  await expect(page.locator('#analytics')).toContainText('Победы: 1');
  await expect(page.locator('#comparison')).toContainText('минимум пять');
  await expect(page.locator('#versions option')).toHaveCount(2);
  await page.locator('#versions').selectOption({ index: 0 });
  await expect(game.locator('#status')).toHaveText('Готов к полёту');
  await game.getByRole('button', { name: 'Старт', exact: true }).click();
  await game.getByRole('button', { name: 'Вниз', exact: true }).click();
  await expect(game.locator('#status')).toHaveText('Поражение');
  await expect(page.locator('#analytics')).toContainText('Поражения: 1');
  const exported = await page.request.get(await page.locator('#export').getAttribute('href') as string);
  expect(exported.headers()['content-disposition']).toContain('attachment');
  const html = await exported.text();
  const path = testInfo.outputPath('demo-export.html'); writeFileSync(path, html, { flag: 'wx' });
  const standalone = await browser.newContext({ offline: true });
  const separate = await standalone.newPage(); await separate.goto(pathToFileURL(path).href);
  expect(await separate.evaluate(() => document.characterSet)).toBe('UTF-8');
  await separate.getByRole('button', { name: 'Старт', exact: true }).click();
  await separate.getByRole('button', { name: 'Вниз', exact: true }).click();
  await expect(separate.locator('#status')).toHaveText('Поражение');
  await expect(separate.getByRole('button', { name: 'Перезапуск' })).toBeVisible();
  await standalone.close();
  await page.getByRole('button', { name: 'Диагностика', exact: true }).click();
  await expect(page.locator('#system-info')).toContainText('База: исправна');
  const copyResponse = page.waitForResponse(r => r.url().endsWith('/api/backups') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Создать резервную копию' }).click();
  const copy = await (await copyResponse).json();
  expect(copy.filename).toMatch(/^backup-[0-9a-f-]+\.sqlite$/);
  // Delete only the file this exact test operation created, never user backups.
  try {
    await expect(page.locator('#backup-result')).toContainText('Копия проверена');
    await page.screenshot({ path: testInfo.outputPath('mvp-playing.png'), fullPage: true });
    await page.reload();
    await page.getByRole('button', { name: 'Игры', exact: true }).click();
    await expect(page.locator('#games button').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('mvp.png'), fullPage: true });
  } finally { unlinkSync(managedPath(`.local/backups/${copy.filename}`, false)); }
});

test('LIVE without configuration gives an honest error and preserves the displayed game', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Создать', exact: true }).click(); await createAndOpen(page);
  await expect(page.locator('#message')).toContainText('Игра сохранена');
  const exported = await page.locator('#export').getAttribute('href');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();

  await page.unroute('**/api/jobs');await page.locator('#generate').click();await page.locator('#jobs-toggle').click();
  await expect(page.locator('#jobs-list')).toContainText('LIVE не настроен');
  await expect(page.locator('#provenance')).toHaveText('Тестовая игра · без LLM');
  expect(await page.locator('#export').getAttribute('href')).toBe(exported);
});
