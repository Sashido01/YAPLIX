import {test,expect} from '@playwright/test';
test('LAN setup: automatic read-only check, exact review, decline and UAC cancellation (simulated)',async({page},info)=>{
 let applies=0,plans=0;
 const adapter={id:'physical-fixture',name:'Wi-Fi [owner] $(literal)',address:'192.168.10.12',prefix:24,profile:'Private'};
 const diagnostics={status:'ACTION_REQUIRED',reason:'Нет подтверждённого Allow; физический телефон не проверен.',manageable:true,nodePath:'C:\\Program Files\\nodejs\\node.exe',ports:[52604,52605],adapters:[adapter],managedRules:[],listeners:[]};
 await page.route('**/api/lan-setup**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/plan')){plans++;await route.fulfill({json:{id:'00000000-0000-4000-8000-000000000001',action:'configure',adapter,nodePath:diagnostics.nodePath,ports:diagnostics.ports,subnet:'192.168.10.0/24',add:[{name:'YAPLIX-LAN-fixture',program:diagnostics.nodePath,ports:diagnostics.ports,subnet:'192.168.10.0/24',adapter}],remove:[]}});}
  else if(path.endsWith('/apply')){applies++;expect(route.request().postDataJSON().consent).toBe(true);await route.fulfill({json:{code:'cancelled_or_unavailable',diagnostics}});}
  else await route.fulfill({json:diagnostics});
 });
 await page.goto('/');const panel=page.locator('[data-lan-setup]');await expect(panel.locator('summary')).toContainText('ACTION_REQUIRED');expect(plans).toBe(0);expect(applies).toBe(0);
 await panel.locator('summary').click();await panel.getByRole('button',{name:'Настроить доступ в частной сети',exact:true}).click();
 await expect(panel.getByRole('heading',{name:'Точный план изменений'})).toBeVisible();await expect(panel.locator('section pre')).toContainText('192.168.10.0/24');
 await expect(panel.locator('section pre')).toContainText('C:\\Program Files\\nodejs\\node.exe');await expect(panel.locator('section pre')).toContainText('Private');
 await expect(panel.getByRole('button',{name:'Применить с UAC'})).toBeDisabled();await panel.getByRole('button',{name:'Отказаться',exact:true}).click();expect(applies).toBe(0);
 await panel.getByRole('button',{name:'Настроить доступ в частной сети',exact:true}).click();await panel.getByRole('checkbox').focus();await page.keyboard.press('Space');await expect(panel.getByRole('checkbox')).toBeChecked();await panel.getByRole('button',{name:'Применить с UAC'}).click();
 await expect(panel.locator('[role=status]')).toContainText('cancelled_or_unavailable');expect(applies).toBe(1);
 await expect(page.locator('#prompt')).toBeEnabled();await expect(page.locator('#generate')).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await panel.locator('summary').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('lan-setup.png')});
});
test('own rule cleanup can be reviewed on Public without offering new access (simulated)',async({page})=>{
 const own={name:'YAPLIX-LAN-fixture',program:'C:\\node.exe',ports:['52605'],local:['192.168.1.0/24'],interfaces:['Old Wi-Fi']};let applies=0;
 await page.route('**/api/lan-setup**',async route=>{
  if(new URL(route.request().url()).pathname.endsWith('/plan')){expect(route.request().postDataJSON().action).toBe('remove');await route.fulfill({json:{id:'00000000-0000-4000-8000-000000000001',adapter:{name:'Wi-Fi',id:'public',address:'192.168.1.2',prefix:24,profile:'Public'},nodePath:'C:\\node.exe',ports:[52604,52605],add:[],remove:[own]}});}
  else if(new URL(route.request().url()).pathname.endsWith('/apply')){applies++;await route.fulfill({json:{code:'cancelled_or_unavailable'}});}
  else await route.fulfill({json:{status:'ACTION_REQUIRED',reason:'Public: новый доступ запрещён.',manageable:false,removable:true,nodePath:'C:\\node.exe',ports:[52604,52605],adapters:[{id:'public',name:'Wi-Fi',address:'192.168.1.2',prefix:24,profile:'Public'}],managedRules:[own],listeners:[]}});
 });
 await page.goto('/');const panel=page.locator('[data-lan-setup]');await panel.locator('summary').click();await panel.getByRole('button',{name:'Удалить правила YAPLIX этой копии'}).click();await expect(panel.locator('section pre')).toContainText(own.name);await expect(panel.locator('section pre')).toContainText('Добавить: 0');await panel.getByRole('button',{name:'Отказаться',exact:true}).click();expect(applies).toBe(0);
});
test('Public or unreadable policy offers diagnosis while configuration stays disabled (simulated)',async({page})=>{
 await page.route('**/api/lan-setup**',route=>route.fulfill({json:{status:'ACTION_REQUIRED',reason:'Public: выберите доверенную Private сеть вручную.',manageable:false,nodePath:'C:\\node.exe',ports:[52604,52605],adapters:[{id:'public',name:'Wi-Fi',address:'192.168.1.2',prefix:24,profile:'Public'}],managedRules:[],listeners:[]}}));
 await page.goto('/');const panel=page.locator('[data-lan-setup]');await panel.locator('summary').click();await expect(panel.locator('[role=status]')).toContainText('Public');
 await expect(panel.getByRole('button',{name:'Настроить доступ в частной сети',exact:true})).toBeDisabled();await expect(panel.getByRole('button',{name:'Проверить без изменений'})).toBeEnabled();await expect(page.locator('#prompt')).toBeEnabled();
});
