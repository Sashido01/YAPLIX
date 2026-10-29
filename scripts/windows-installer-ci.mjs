// Hosted Windows acceptance for the real NSIS Lite/Full files and source bootstrap.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {closeSync,existsSync,mkdirSync,openSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';

if(process.platform!=='win32'||!process.env.CI)throw Error('Windows hosted CI only.');
const root=fileURLToPath(new URL('../',import.meta.url));
const local=join(root,'.local/release-ci-001');
const builds=join(local,'windows-build/packages');
const evidenceHome=join(local,'evidence');mkdirSync(evidenceHome,{recursive:true});
const readJSON=file=>JSON.parse(readFileSync(file,'utf8'));
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const evidence={platform:process.platform,checks:[],packages:{}};
const offlineEnv={...process.env,LIVE_PROVIDER:'none',TELEGRAM_UPDATES:'off'};
for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete offlineEnv[name];
// GitHub's pwsh parent may expose only PowerShell 7 modules to powershell.exe.
delete offlineEnv.PSModulePath;

function run(binary,args,env=offlineEnv,timeout=600000){
 const result=spawnSync(binary,args,{cwd:root,env,encoding:'utf8',timeout,windowsHide:true,maxBuffer:4*1024*1024});
 const safeError=((result.stderr??'')+'\n'+(result.stdout??'')).slice(-2500)
  .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1***@')
  .replace(/\b(?:gho_|ghp_|github_pat_)[A-Za-z0-9_]+\b/g,'[REDACTED]');
 if(result.error)throw Error(`${binary} ${result.error.message}; last output: ${safeError}`);
 assert.equal(result.status,0,`${binary} exited ${result.status}; ${safeError}`);
 return result.stdout;
}
// Installed desktop servers inherit standard handles. Redirect commands that
// start them to files so spawnSync waits for the installer, not pipe EOF from
// the surviving server process.
function runToFile(binary,args,env,name,timeout=600000){
 const file=join(evidenceHome,name),fd=openSync(file,'w',0o600);
 let result;
 try{result=spawnSync(binary,args,{cwd:root,env,stdio:['ignore',fd,fd],timeout,windowsHide:true});}
 finally{closeSync(fd);}
 const safeError=readFileSync(file,'utf8').slice(-2500)
  .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1***@')
  .replace(/\b(?:gho_|ghp_|github_pat_)[A-Za-z0-9_]+\b/g,'[REDACTED]');
 if(result.error)throw Error(`${binary} ${result.error.message}; last output: ${safeError}`);
 assert.equal(result.status,0,`${binary} exited ${result.status}; ${safeError}`);
}
const profile=name=>join(local,'profiles',name);
function installed(profilePath,expectedBrowser){
 const pointer=readJSON(join(profilePath,'program/current.json'));
 assert.match(pointer.id,/^[0-9a-f]{64}$/);
 const app=join(profilePath,'program/versions',pointer.id);
 assert.equal(readJSON(join(app,'packaging/delivery.json')).browser,expectedBrowser);
 return {app,id:pointer.id};
}
async function waitFor(file,present=true){
 for(let i=0;i<100;i++){if(existsSync(file)===present)return;await delay(100);}
 throw Error(`Timed out waiting for profile state: ${file}`);
}
async function loopbackGet(label,url){
 let last;
 for(let attempt=0;attempt<4;attempt++){
  try{return await fetch(url,{headers:{Connection:'close'},signal:AbortSignal.timeout(5000)});}
  catch(error){last=error;if(attempt<3)await delay(250);}
 }
 throw Error(`${label}: loopback GET failed (${last?.cause?.code??last?.message??'unknown'})`);
}
async function oneRequest(label,url,options){
 try{return await fetch(url,options);}
 catch(error){throw Error(`${label}: request failed (${error?.cause?.code??error?.message??'unknown'})`);}
}
async function verifyProfile(profilePath,expectedBrowser){
 const {app,id}=installed(profilePath,expectedBrowser);
 assert.equal(existsSync(join(profilePath,'applications/YAPLIX/YAPLIX.lnk')),true,'Test shortcuts escaped the isolated profile.');
 const node=join(app,'runtime/node.exe'),desktop=join(app,'scripts/desktop.mjs');
 const dataHome=join(profilePath,'data');
 const env={...offlineEnv,YAPLIX_DATA_HOME:dataHome};
 console.log(`Verifying ${expectedBrowser}: protected browser`);
 const probe=readJSONFromRun(node,[join(app,'scripts/install-probe.mjs')],env);
 assert.equal(probe.sandboxReady,true,'Protected browser probe did not pass.');
 const state=readJSON(join(dataHome,'desktop.json'));
 const base=`http://127.0.0.1:${state.port}`;
 console.log(`Verifying ${expectedBrowser}: API and UI`);
 const health=await loopbackGet(`${expectedBrowser} health`,base+'/healthz');
 assert.equal(health.status,200);
 const ui=await loopbackGet(`${expectedBrowser} UI`,base+'/');
 assert.equal(ui.status,200);assert.match(await ui.text(),/YAPLIX/);
 // Production ships no gallery. Seed only this explicitly isolated CI profile
 // through the installed Store, then verify the real API and restart persistence.
 assert.equal((await loopbackGet(`${expectedBrowser} removed gallery`,base+'/api/gallery')).status,404);
 const empty=await (await loopbackGet(`${expectedBrowser} empty library`,base+'/api/games')).json();
 assert.deepEqual(empty.games,[]);
 const fixture=readFileSync(new URL('../tests/fixtures/game.html',import.meta.url),'utf8');
 const storeModule=pathToFileURL(join(app,'build/src/store.js')).href;
 const seed=`import {Store} from ${JSON.stringify(storeModule)};
 const store=new Store();try{const versions=[];for(let i=0;i<3;i++)versions.push(store.save({prompt:'Windows installer acceptance '+i,audience:'default',genre:'clicker',mechanics:['score'],controls:['keyboard','touch','pointer'],responsive:true,webview:true},{html:${JSON.stringify(fixture)},method:'mock',provider:'authored-test-fixture',model:null,generationStatus:'succeeded',validationStatus:'unverified'}));console.log(JSON.stringify(versions));}finally{store.close();}`;
 const seeded=readJSONFromRun(node,['--input-type=module','--eval',seed],env);
 const versions=[];
 for(const version of seeded){
  const response=await loopbackGet(`${expectedBrowser} seeded version`,base+'/api/versions/'+version.versionId);
  assert.equal(response.status,200);
  const saved=await response.json();assert.equal(saved.html,fixture);
  versions.push({id:saved.versionId,sha256:createHash('sha256').update(saved.html).digest('hex')});
 }
 runToFile(node,[desktop,'--stop','--no-open'],env,'desktop-stop.log',40000);
 await waitFor(join(dataHome,'desktop.lock'),false);
 runToFile(node,[desktop,'--no-open'],env,'desktop-start.log',40000);
 const restarted=readJSON(join(dataHome,'desktop.json'));
 for(const version of versions){
  const response=await loopbackGet(`${expectedBrowser} persisted version`,`http://127.0.0.1:${restarted.port}/api/versions/${version.id}`);
  assert.equal(response.status,200);
  const saved=await response.json();
  assert.equal(createHash('sha256').update(saved.html).digest('hex'),version.sha256);
 }
 runToFile(node,[desktop,'--stop','--no-open'],env,'desktop-stop.log',40000);
 await waitFor(join(dataHome,'desktop.lock'),false);
 const db=new DatabaseSync(join(dataHome,'data/yaplix.sqlite'),{readOnly:true});
 try{
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  assert.equal(db.prepare('SELECT count(*) AS count FROM games').get().count,3);
 }finally{db.close();}
 return {browser:expectedBrowser,version:id,games:3,api:true,ui:true,sandbox:true,sqlite:'ok',restart:true};
}
function readJSONFromRun(binary,args,env){
 const output=run(binary,args,env,30000);
 return JSON.parse(output.trim());
}

try{
 const nodeArchive=join(local,'tools/node-v24.18.0-win-x64.zip');
 const bootstrapHome=join(local,'bootstrap');
 const sourceProfile=profile('source-lite');
 mkdirSync(sourceProfile,{recursive:true});
 const sourceEnv={...process.env,YAPLIX_BOOTSTRAP_HOME:bootstrapHome,YAPLIX_BOOTSTRAP_ARCHIVE:nodeArchive,YAPLIX_INSTALL_OFFLINE:'1',LIVE_PROVIDER:'none',TELEGRAM_UPDATES:'off'};
 delete sourceEnv.PSModulePath;
 const sourceScript=join(root,'install-windows.ps1');
 run('powershell.exe',['-NoProfile','-Command','Get-Command Get-FileHash | Out-Null'],sourceEnv,30000);
 const isolatedNode=run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',sourceScript,'--runtime-only'],sourceEnv,120000).trim().split(/\r?\n/).at(-1).trim();
 assert.equal(run(isolatedNode,['--version'],sourceEnv,10000).trim(),'v24.18.0');
 runToFile('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',sourceScript,'--headless','--test-profile',sourceProfile],sourceEnv,'source-install.log',900000);
 evidence.source=await verifyProfile(sourceProfile,'system-chrome');
 evidence.checks.push('install-windows.ps1 isolated Node and Lite source installation');

 for(const mode of ['lite','full']){
  const artifact=join(builds,`YAPLIX-0.0.1-windows-x64-${mode}-setup.exe`);
  const line=readFileSync(artifact+'.sha256','utf8').trim();
  assert.equal(line.split(/\s+/)[0],sha(artifact));
  const target=profile(mode);mkdirSync(target,{recursive:true});
  runToFile(artifact,['/S'],{...offlineEnv,YAPLIX_INSTALL_TEST_PROFILE:target},`${mode}-install.log`,600000);
  evidence.packages[mode]={sha256:sha(artifact),...(await verifyProfile(target,mode==='lite'?'system-chrome':'isolated-chromium'))};
  evidence.checks.push(`${mode} NSIS installer, API/UI, protected browser, three isolated fixtures and SQLite restart`);
 }
 evidence.status='PASS';
}finally{
 writeFileSync(join(evidenceHome,'windows.json'),JSON.stringify(evidence,null,2)+'\n');
}
console.log(JSON.stringify(evidence,null,2));
