import {expect} from '@playwright/test';
import type {Page} from '@playwright/test';

type ProviderCheck = { configured:boolean; ready:boolean; state:string; reasonCode:string|null };
const fixtureChecks = new WeakMap<Page,{ configured:boolean }>();

async function setFixtureProviderReadiness(page:Page,configured:boolean){
  // Let the production UI finish its initial readiness fetch before the
  // synthetic routes are installed, otherwise a late unconfigured response
  // can overwrite the fixture's explicit check result.
  await expect(page.locator('body')).toHaveAttribute('data-ready','true');
  let state=fixtureChecks.get(page);
  if(!state){
    state={configured:false};fixtureChecks.set(page,state);
    await page.route('**/api/providers',route=>route.fulfill({json:{timeouts:{},providers:[
      {mode:'ollama-cloud',configured:state!.configured,state:state!.configured?'needs_verification':'not_configured'},
      {mode:'openrouter',configured:state!.configured,state:state!.configured?'needs_verification':'not_configured'},
      {mode:'chatgpt',configured:false,state:'not_configured'}
    ]}}));
    await page.route('**/api/providers/*/check',route=>{
      const mode=new URL(route.request().url()).pathname.split('/').at(-2)??'ollama-cloud';
      const model=mode==='openrouter'?'openrouter/free':mode==='chatgpt'?'gpt-6.1-sol':'gemma4:31b';
      const ready=state!.configured;
      const body:ProviderCheck={configured:ready,ready,state:ready?(mode==='openrouter'?'dynamic_upstream_ready':'ready'):'not_configured',reasonCode:ready?null:'PROVIDER_NOT_CONFIGURED'};
      return route.fulfill({json:{mode,model,...body}});
    });
  }else state.configured=configured;
  const settings=page.locator('details.tune').first();
  if(!await page.locator('#check-provider').isVisible())await settings.locator('summary').click();
  state.configured=configured;
  await page.locator('#check-provider').click();
  const mode=await page.locator('#provider-mode').inputValue();
  await expect(page.locator('#model-connection-status')).toContainText(configured?(mode==='openrouter'?'соединение доступно':'каталог модели доступен'):'ключ не настроен');
  // The synthetic route only changes the readiness response. Re-run the
  // editor's existing input-driven availability calculation after that change.
  await page.locator('#change').dispatchEvent('input');
}

export async function prepareSyntheticProviderUI(page:Page){await setFixtureProviderReadiness(page,true);}
export async function prepareUnconfiguredProviderUI(page:Page){await setFixtureProviderReadiness(page,false);}
export async function restoreUnconfiguredUIReadiness(page:Page){
  const state=fixtureChecks.get(page);if(!state)return;
  await setFixtureProviderReadiness(page,false);
  if(await page.locator('details.tune').first().evaluate(e=>(e as HTMLDetailsElement).open))await page.locator('details.tune').first().locator('summary').click();
}

export async function createAndOpen(page:Page,button='Создать игру',fixture=true){
  if(fixture){
    // UI preflight readiness is synthetic; the ordinary durable job endpoint
    // uses the browser server test-only transport and never contacts a provider.
    await prepareSyntheticProviderUI(page);
  }
  const prompt=page.locator('#prompt');if(await prompt.inputValue()==='')await prompt.fill('Синтетическая тестовая игра');
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/jobs'&&r.request().method()==='POST');
  await page.getByRole('button',{name:button,exact:true}).click();const job=await(await response).json();
  await expect.poll(async()=>page.evaluate(async id=>(await(await fetch('/api/jobs/'+id)).json()).stage,job.jobId),{timeout:18000}).toBe('completed');
  const saved=await page.evaluate(async id=>await(await fetch('/api/jobs/'+id)).json(),job.jobId);
  const versions=page.locator('#versions');
  if(await page.locator('#export').getAttribute('href')!==`/api/versions/${saved.versionId}/export`){
    await expect.poll(async()=>await page.locator('#export').getAttribute('href')===`/api/versions/${saved.versionId}/export`||((await page.locator('#job-toast-text').textContent())??'').includes(saved.spec.prompt.slice(0,60)),{timeout:18000}).toBe(true);
    if(await page.locator('#export').getAttribute('href')!==`/api/versions/${saved.versionId}/export`)await page.locator('#job-toast-open').click();
  }
  // The export link and title identify the exact loaded version even while the
  // select's restoration event is still settling after a background open.
  await expect(page.locator('#export')).toHaveAttribute('href',`/api/versions/${saved.versionId}/export`,{timeout:18000});
  await expect(page.locator('#game iframe')).toBeVisible({timeout:18000});
  if(fixture)await restoreUnconfiguredUIReadiness(page);
  return {...job,...saved};
}
