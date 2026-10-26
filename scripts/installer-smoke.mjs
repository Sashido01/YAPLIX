// Acceptance of the actual downloaded-style executable on current Ubuntu.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright-core';
const artifact=resolve(process.argv[2]),profile=resolve(process.argv[3]),out=resolve(process.argv[4]??'.local/install-002/acceptance');mkdirSync(out,{recursive:true});mkdirSync(profile,{recursive:true});
const temp=resolve(process.env.YAPLIX_INSTALL_TEST_TMP??'.local/i2tmp');mkdirSync(temp,{recursive:true});
const env={...process.env,TMPDIR:temp,TEMP:temp,TMP:temp};
for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete env[name];
const child=spawn(artifact,['--no-open','--test-profile',profile],{env,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
let browser,root;const evidence={artifact,profile,checks:[],externalBrowserRequests:[]};
const view=join(profile,'program/installer/view.json');
try{
 for(let i=0;i<300&&!existsSync(view);i++){if(child.exitCode!==null)throw Error('Installer exited before GUI: '+log);await delay(100);}
 const {url}=JSON.parse(readFileSync(view,'utf8')),origin=new URL(url).origin;
 assert.equal((await fetch(origin+'/api/status')).status,403);evidence.checks.push('installer owner token enforced');
 browser=await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true,env:{...env,CHROME_DEVEL_SANDBOX:'/opt/google/chrome/chrome-sandbox'}});
 const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',r=>{if(!/^http:\/\/127\.0\.0\.1:\d+\//.test(r.request().url())){evidence.externalBrowserRequests.push(r.request().url());return r.abort();}return r.continue();});
 await page.goto(url);await page.locator('h1').waitFor();await page.screenshot({path:join(out,'install-390.png'),fullPage:true});
 for(let i=0;i<400;i++){if(new URL(page.url()).origin!==origin)break;if(await page.locator('#error').isVisible())throw Error(await page.locator('#error').textContent());await delay(100);}
 assert.notEqual(new URL(page.url()).origin,origin,'Installer did not launch YAPLIX');evidence.checks.push('real CHECK→PLAN→PREPARE→INSTALL→VERIFY→LAUNCH→DONE');
 root=join(profile,'program/versions',JSON.parse(readFileSync(join(profile,'program/current.json'),'utf8')).id);
 const api=new URL(page.url()).origin;
 const saved=await fetch(api+'/api/gallery/prism-maze',{method:'POST',headers:{'Content-Type':'application/json',Connection:'close'},body:'{}'});assert.equal(saved.status,201);const version=await saved.json();
 await page.reload();await page.screenshot({path:join(out,'app-390.png'),fullPage:true});evidence.checks.push('actual API and UI ready; authored game saved');
 const command=(...args)=>{const r=spawnSync(join(root,'runtime/node'),[join(root,'scripts/desktop.mjs'),...args,'--no-open'],{env:{...env,YAPLIX_DATA_HOME:join(profile,'data')},encoding:'utf8',timeout:40000});assert.ifError(r.error);assert.equal(r.status,0,r.stderr);return r.stdout;};
 command('--stop');for(let i=0;i<100&&existsSync(join(profile,'data/desktop.lock'));i++)await delay(100);
 command();const state=JSON.parse(readFileSync(join(profile,'data/desktop.json'),'utf8'));
 const reopened=await(await fetch('http://127.0.0.1:'+state.port+'/api/versions/'+version.versionId,{headers:{Connection:'close'}})).json();assert.equal(reopened.html,version.html);evidence.checks.push('shortcut target restart preserves game');
 assert.deepEqual(errors,[]);assert.deepEqual(evidence.externalBrowserRequests,[]);evidence.status='PASS';
}finally{
 await browser?.close();
 if(root)spawnSync(join(root,'runtime/node'),[join(root,'scripts/desktop.mjs'),'--stop','--no-open'],{env:{...env,YAPLIX_DATA_HOME:join(profile,'data')},timeout:20000});
 if(child.exitCode===null){child.kill('SIGTERM');await delay(500);}
 writeFileSync(join(out,'installer-process.log'),log);writeFileSync(join(out,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');
}
console.log(JSON.stringify(evidence,null,2));
