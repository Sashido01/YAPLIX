// Developer-only acceptance on an extracted package; never uses a personal DB.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright-core';
const root=resolve(process.argv[2]),evidence=resolve(process.argv[3]??'.local/install-001/payload-smoke');
mkdirSync(evidence,{recursive:true});
const home=mkdtempSync(resolve(evidence,'data-'));
const runtime=resolve(root,'runtime/node'),launcher=resolve(root,'scripts/desktop.mjs');
const env={...process.env,YAPLIX_DATA_HOME:home};
for(const k of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy','NODE_TEST_CONTEXT'])delete env[k];
const command=(...args)=>{const r=spawnSync(runtime,[launcher,...args,'--no-open'],{cwd:root,env,encoding:'utf8',timeout:40000});assert.ifError(r.error);assert.equal(r.status,0,r.stderr);return r.stdout;};
const state=()=>JSON.parse(readFileSync(resolve(home,'desktop.json'),'utf8'));
const stop=async()=>{command('--stop');for(let i=0;i<100&&existsSync(resolve(home,'desktop.lock'));i++)await delay(100);assert.equal(existsSync(resolve(home,'desktop.lock')),false);};
const result={type:'extracted-DEB (not graphical installation)',runtime:spawnSync(runtime,['--version'],{encoding:'utf8'}).stdout.trim(),home,externalBrowserRequests:[],checks:[]};
let browser;
try{
 command();const first=state(),base='http://127.0.0.1:'+first.port;result.checks.push('bundled runtime starts without npm');
 command();assert.equal(state().instance,first.instance);result.checks.push('repeat launch attaches same instance');
 browser=await chromium.launch({headless:true,executablePath:resolve(root,'browsers/chromium-1248/chrome-linux64/chrome')});
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',r=>{const url=r.request().url();if(!url.startsWith(base)&&!url.startsWith('data:')){result.externalBrowserRequests.push(url);return r.abort();}return r.continue();});
 await page.goto(base);await page.getByRole('button',{name:'Игры',exact:true}).click();await page.getByRole('button',{name:'Световой лабиринт · офлайн',exact:true}).click();
 await page.frameLocator('#game iframe').locator('canvas').waitFor({state:'visible'});
 assert.equal(await page.locator('#game iframe').getAttribute('sandbox'),'allow-scripts');
 const version=new URL(page.url()).searchParams.get('version');const record=await(await fetch(base+'/api/versions/'+version,{headers:{Connection:'close'}})).json();
 await page.screenshot({path:resolve(evidence,'payload-390.png'),fullPage:true});result.checks.push('mobile authored game and opaque iframe');
 const backup=await fetch(base+'/api/backups',{method:'POST',headers:{'Content-Type':'application/json',Connection:'close'},body:'{}'});assert.equal(backup.status,201);result.checks.push('verified SQLite backup');
 await stop();command();const second=state(),url='http://127.0.0.1:'+second.port;
 assert.notEqual(second.instance,first.instance);
 const reopened=await(await fetch(url+'/api/versions/'+version,{headers:{Connection:'close'}})).json();assert.equal(reopened.html,record.html);result.checks.push('game survives full restart');
 await stop();
 // Reinstall the identical artifact over stopped app files; user data is separate.
 const artifact=resolve('.local/install-001/packages/YAPLIX-0.0.1-ubuntu24.04-amd64.deb');
 const extraction=spawnSync('dpkg-deb',['--extract',artifact,resolve(root,'../..')],{encoding:'utf8'});assert.ifError(extraction.error);assert.equal(extraction.status,0,extraction.stderr);
 command();const third=state();const afterUpdate=await(await fetch('http://127.0.0.1:'+third.port+'/api/versions/'+version,{headers:{Connection:'close'}})).json();assert.equal(afterUpdate.html,record.html);result.checks.push('game survives stopped payload re-extraction');
 assert.deepEqual(errors,[]);assert.deepEqual(result.externalBrowserRequests,[]);result.status='PASS';
}finally{await browser?.close();await stop();writeFileSync(resolve(evidence,'evidence.json'),JSON.stringify(result,null,2)+'\n');}
console.log(JSON.stringify(result,null,2));
