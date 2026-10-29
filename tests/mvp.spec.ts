import {createAndOpen,prepareUnconfiguredProviderUI} from './ui-jobs-helper.ts';
import { test, expect } from '@playwright/test';
import { unlinkSync, writeFileSync } from 'node:fs';
import { managedPath } from '../src/store.ts';
import { pathToFileURL } from 'node:url';

test.beforeEach(async({request})=>{const response=await request.post('/__test/reset');expect(response.status()).toBe(200);});

test('user-created game link resolves the saved version and preserves library title',async({page})=>{
  await page.goto('/');await page.locator('#prompt').fill('Original game idea');await createAndOpen(page);
  const gameId=new URL(page.url()).searchParams.get('game');
  const versionId=await page.locator('#versions').inputValue();
  await page.goto('/?game='+gameId);await expect(page.locator('#export')).toHaveAttribute('href','/api/versions/'+versionId+'/export');await expect(page.locator('#game-title')).toHaveText('Original game idea');await expect(page.frameLocator('#game iframe').getByRole('button',{name:'Start',exact:true})).toBeVisible();
});

test('user creates a game, wins, changes goal, selects old version, exports and backs up', async ({ page, browser }, testInfo) => {
  // User edit, independent offline browser, backup and reload are separate
  // operations; per-assertion waits remain bounded at the normal five seconds.
  test.setTimeout(45000);
  await page.goto('/'); await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await createAndOpen(page);
  await expect(page.locator('#message')).toHaveText(/Игра (сохранена|готова)\. Можно играть\./);
  const originalVersion = await page.locator('#versions').inputValue();
  const game = page.frameLocator('#game iframe');
  await game.getByRole('button', { name: 'Start', exact: true }).click();
  for (let i = 0; i < 3; i++) await game.getByRole('button', { name: 'Point', exact: true }).click();
  await expect(game.locator('#status')).toHaveText('Won');
  await expect(page.locator('#analytics')).toContainText('Победы: 1');
  await page.locator('#edit-game').click();
  await page.locator('#change').fill('Теперь собери 5 грузов');
  await createAndOpen(page,'Создать следующую версию');
  await expect(page.locator('#versions option')).toHaveCount(2);
  await expect(page.locator('#game iframe')).toBeVisible();
  const editedVersion = await page.locator('#versions').inputValue();
  expect(editedVersion).not.toBe(originalVersion);
  await expect(page.locator('#comparison')).toContainText('минимум пять');
  await page.locator('#create-more > summary').click();
  await page.locator('#versions').selectOption(originalVersion);
  await expect(game.locator('#status')).toHaveText('Ready');
  const exported = await page.request.get(await page.locator('#export').getAttribute('href') as string);
  expect(exported.headers()['content-disposition']).toContain('attachment');
  const html = await exported.text();
  const path = testInfo.outputPath('user-game-export.html'); writeFileSync(path, html, { flag: 'wx' });
  const standalone = await browser.newContext({ offline: true });
  const separate = await standalone.newPage(); await separate.goto(pathToFileURL(path).href);
  expect(await separate.evaluate(() => document.characterSet)).toBe('UTF-8');
  await separate.getByRole('button', { name: 'Start', exact: true }).click();
  await separate.getByRole('button', { name: 'Trap', exact: true }).click();
  await expect(separate.locator('#status')).toHaveText('Lost');
  await separate.reload();await expect(separate.locator('#status')).toHaveText('Ready');
  await standalone.close();
  await page.getByRole('button',{name:'Игры',exact:true}).first().click();
  await page.locator('#system > summary').click();
  await expect(page.locator('#system-info')).toContainText('База: исправна');
  const copyResponse = page.waitForResponse(r => r.url().endsWith('/api/backups') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Создать резервную копию' }).click();
  const copy = await (await copyResponse).json();
  expect(copy.filename).toMatch(/^backup-[0-9a-f-]+\.sqlite$/);
  // Delete only the file this exact test operation created, never user backups.
  try {
    await expect(page.locator('#backup-result')).toContainText('Копия проверена');
    await page.screenshot({ path: testInfo.outputPath('mvp-playing.png'), fullPage: true });
    await page.goto('/');
    await page.locator('[data-view="library"]:visible').click();
    await expect(page.locator('body')).toHaveAttribute('data-screen','library');
    await expect(page.locator('#games button').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('mvp.png'), fullPage: true });
  } finally { unlinkSync(managedPath(`.local/backups/${copy.filename}`, false)); }
});

test('LIVE without configuration gives an honest error and preserves the displayed game', async ({ page }) => {
  await page.goto('/'); await prepareUnconfiguredProviderUI(page); await page.getByRole('button', { name: 'Игры', exact: true }).first().click();
  await expect(page.locator('#games')).toContainText('Вы пока не создали ни одной игры');
  await expect(page.locator('#games button',{hasText:'Создать игру'})).toBeVisible();
  await page.getByRole('button', { name: 'Создать', exact: true }).click();

  let posts=0;page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/jobs')posts++;});
  await expect(page.locator('#generate')).toBeDisabled();
  await expect(page.locator('#model-connection-status')).toContainText('ключ не настроен');
  expect(posts).toBe(0);
});
