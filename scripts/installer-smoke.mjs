// Acceptance of the actual downloaded-style executable on current Ubuntu.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {mkdirSync,readFileSync,writeFileSync,existsSync,statSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright-core';
const artifact=resolve(process.argv[2]),profile=resolve(process.argv[3]),out=resolve(process.argv[4]??'.local/install-002/acceptance'),launchCwd=join(profile,'launch-cwd');mkdirSync(out,{recursive:true,mode:0o700});mkdirSync(profile,{recursive:true,mode:0o700});mkdirSync(launchCwd,{recursive:true,mode:0o700});
const temp=resolve('.local/i2tmp');mkdirSync(temp,{recursive:true});
const env={...process.env,TMPDIR:temp,TEMP:temp,TMP:temp};
for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete env[name];
for(const name of ['OLLAMA_API_KEY','OLLAMA_CLOUD_API_KEY','CLOUD_API_KEY','OPENAI_API_KEY','CHATGPT_ACCESS_TOKEN','CHATGPT_REFRESH_TOKEN'])delete env[name];
const artifactSha=createHash('sha256').update(readFileSync(artifact)).digest('hex'),shaLine=readFileSync(artifact+'.sha256','utf8').trim();assert.equal(shaLine,artifactSha+'  '+artifact.split(/[\\/]/).at(-1));
const child=spawn(artifact,['--no-open','--test-profile',profile],{cwd:launchCwd,env,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
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
 assert.notEqual(new URL(page.url()).origin,origin,'Installer did not launch YAPLIX');await page.getByRole('button',{name:'Создать',exact:true}).waitFor({state:'visible',timeout:15000});evidence.checks.push('real CHECK→PLAN→PREPARE→INSTALL→VERIFY→LAUNCH→DONE; installed UI loaded');
 root=join(profile,'program/versions',JSON.parse(readFileSync(join(profile,'program/current.json'),'utf8')).id);
 const api=new URL(page.url()).origin;
 const library=await(await fetch(api+'/api/games',{headers:{Connection:'close'}})).json();assert.deepEqual(library.games,[]);await page.getByRole('button',{name:'Игры',exact:true}).click();await page.getByText('Вы пока не создали ни одной игры').waitFor();await page.screenshot({path:join(out,'app-390.png'),fullPage:true});evidence.checks.push('installed fresh library is empty with a create action');
 const command=(...args)=>{const r=spawnSync(join(root,'runtime/node'),[join(root,'scripts/desktop.mjs'),...args,'--no-open'],{env:{...env,YAPLIX_DATA_HOME:join(profile,'data')},encoding:'utf8',timeout:40000});assert.ifError(r.error);assert.equal(r.status,0,r.stderr);return r.stdout;};
 command('--stop');for(let i=0;i<100&&existsSync(join(profile,'data/desktop.lock'));i++)await delay(100);
 const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(join(profile,'data/data/yaplix.sqlite'),{readOnly:true});try{assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check,'ok');assert.equal(db.prepare('SELECT count(*) n FROM versions').get().n,0);evidence.sqlite={integrity:'ok',games:0,versions:0};}finally{db.close();}evidence.checks.push('read-only SQLite integrity and empty library verified after stop');
 command();const state=JSON.parse(readFileSync(join(profile,'data/desktop.json'),'utf8'));
 const reopened=await(await fetch('http://127.0.0.1:'+state.port+'/api/games',{headers:{Connection:'close'}})).json();assert.deepEqual(reopened.games,[]);evidence.checks.push('shortcut target restart preserves the empty user library');
 const traceDir=join(profile,'data/diagnostics/operations'),traceFiles=readdirSync(traceDir).filter(name=>/^[0-9a-f-]{36}\.jsonl(?:\.1)?$/i.test(name));const rows=traceFiles.flatMap(name=>readFileSync(join(traceDir,name),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))).sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
 const events=rows.map(row=>row.event),required=['install.started','install.prepared','install.installed','install.verified','install.launched','install.completed','desktop.started','desktop.backend_ready','startup.api_ready','startup.ui_ready','desktop.stop_requested','desktop.stopped','startup.stopped','desktop.restart'];for(const event of required)assert.ok(events.includes(event),'missing operation event '+event);
 assert.ok(rows.every(row=>row.operationId&&row.stage&&['STARTED','PASS','FAIL','SKIPPED'].includes(row.status)&&Number.isFinite(Date.parse(row.timestamp))&&(row.durationMs===null||Number.isFinite(row.durationMs))));assert.ok(new Set(rows.map(row=>row.operationId)).size>=3);
 assert.equal(statSync(traceDir).mode&0o777,0o700);for(const name of traceFiles)assert.equal(statSync(join(traceDir,name)).mode&0o777,0o600);evidence.operationTrace={files:traceFiles,operationIds:[...new Set(rows.map(row=>row.operationId))],events:rows.map(({timestamp,operationId,stage,event,status,durationMs,errorCode})=>({timestamp,operationId,stage,event,status,durationMs,errorCode})),directoryMode:'0700',fileModes:'0600'};evidence.checks.push('private persisted operation trace covers install, API/UI readiness, stop and restart');
 assert.deepEqual(errors,[]);assert.deepEqual(evidence.externalBrowserRequests,[]);evidence.status='PASS';
}finally{
 await browser?.close();
 if(root)spawnSync(join(root,'runtime/node'),[join(root,'scripts/desktop.mjs'),'--stop','--no-open'],{env:{...env,YAPLIX_DATA_HOME:join(profile,'data')},timeout:20000});
 if(child.exitCode===null){child.kill('SIGTERM');await delay(500);}
 writeFileSync(join(out,'installer-process.log'),log);writeFileSync(join(out,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');
}
console.log(JSON.stringify(evidence,null,2));
