import {expect} from '@playwright/test';
import type {Page} from '@playwright/test';
export async function createAndOpen(page:Page,button='Создать игру',fixture=true){
  if(fixture){await page.unroute('**/api/jobs');await page.route('**/api/jobs',route=>{const request=route.request();return request.method()==='POST'?route.fallback({postData:JSON.stringify({...request.postDataJSON(),mode:'demo'})}):route.fallback();});}
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/jobs'&&r.request().method()==='POST');
  await page.getByRole('button',{name:button,exact:true}).click();const job=await(await response).json();
  if(await page.locator('#jobs-panel').isHidden())await page.locator('#jobs-toggle').click();
  const row=page.locator('[data-job="'+job.jobId+'"]');await expect(row).toContainText('Готово',{timeout:18000});await row.getByRole('button',{name:'Играть',exact:true}).click();
}
