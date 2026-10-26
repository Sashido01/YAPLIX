// Hosted Windows acceptance for the real NSIS Lite/Full files and source bootstrap.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
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

function run(binary,args,env=offlineEnv,timeout=600000){
 const result=spawnSync(binary,args,{cwd:root,env,encoding:'utf8',timeout,windowsHide:true,maxBuffer:4*1024*1024});
 assert.ifError(result.error);
 assert.equal(result.status,0,`${binary} exited ${result.status}; inspect isolated installer profile and CI step.`);
 return result.stdout;
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
async function verifyProfile(profilePath,expectedBrowser){
 const {app,id}=installed(profilePath,expectedBrowser);
 assert.equal(existsSync(join(profilePath,'applications/YAPLIX/YAPLIX.lnk')),true,'Test shortcuts escaped the isolated profile.');
 const node=join(app,'runtime/node.exe'),desktop=join(app,'scripts/desktop.mjs');
 const dataHome=join(profilePath,'data');
 const env={...offlineEnv,YAPLIX_DATA_HOME:dataHome};
 const probe=readJSONFromRun(node,[join(app,'scripts/install-probe.mjs')],env);
 assert.equal(probe.sandboxReady,true,'Protected browser probe did not pass.');
 const state=readJSON(join(dataHome,'desktop.json'));
 const base=`http://127.0.0.1:${state.port}`;
 const health=await fetch(base+'/healthz',{signal:AbortSignal.timeout(5000)});
 assert.equal(health.status,200);
 const ui=await fetch(base+'/',{signal:AbortSignal.timeout(5000)});
 assert.equal(ui.status,200);assert.match(await ui.text(),/YAPLIX/);
 const gallery=await (await fetch(base+'/api/gallery',{signal:AbortSignal.timeout(5000)})).json();
 assert.deepEqual(gallery.games.map(game=>game.id),['ember-blocks','prism-maze','arena-target']);
 const versions=[];
 for(const game of gallery.games){
  const response=await fetch(base+'/api/gallery/'+game.id,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
  assert.equal(response.status,201);
  const version=await response.json();assert.match(version.html,/<html/i);
  versions.push({id:version.versionId,sha256:createHash('sha256').update(version.html).digest('hex')});
 }
 run(node,[desktop,'--stop','--no-open'],env,40000);
 await waitFor(join(dataHome,'desktop.lock'),false);
 run(node,[desktop,'--no-open'],env,40000);
 const restarted=readJSON(join(dataHome,'desktop.json'));
 for(const version of versions){
  const response=await fetch(`http://127.0.0.1:${restarted.port}/api/versions/${version.id}`,{signal:AbortSignal.timeout(5000)});
  assert.equal(response.status,200);
  const saved=await response.json();
  assert.equal(createHash('sha256').update(saved.html).digest('hex'),version.sha256);
 }
 run(node,[desktop,'--stop','--no-open'],env,40000);
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
 const sourceEnv={...process.env,YAPLIX_BOOTSTRAP_HOME:bootstrapHome,YAPLIX_BOOTSTRAP_ARCHIVE:nodeArchive,LIVE_PROVIDER:'none',TELEGRAM_UPDATES:'off'};
 const sourceScript=join(root,'install-windows.ps1');
 const isolatedNode=run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',sourceScript,'--runtime-only'],sourceEnv,120000).trim().split(/\r?\n/).at(-1).trim();
 assert.equal(run(isolatedNode,['--version'],sourceEnv,10000).trim(),'v24.18.0');
 run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',sourceScript,'--headless','--test-profile',sourceProfile],sourceEnv,600000);
 evidence.source=await verifyProfile(sourceProfile,'system-chrome');
 evidence.checks.push('install-windows.ps1 isolated Node and Lite source installation');

 for(const mode of ['lite','full']){
  const artifact=join(builds,`YAPLIX-0.0.1-windows-x64-${mode}-setup.exe`);
  const line=readFileSync(artifact+'.sha256','utf8').trim();
  assert.equal(line.split(/\s+/)[0],sha(artifact));
  const target=profile(mode);mkdirSync(target,{recursive:true});
  run(artifact,['/S'],{...offlineEnv,YAPLIX_INSTALL_TEST_PROFILE:target},600000);
  evidence.packages[mode]={sha256:sha(artifact),...(await verifyProfile(target,mode==='lite'?'system-chrome':'isolated-chromium'))};
  evidence.checks.push(`${mode} NSIS installer, API/UI, protected browser, three games and SQLite restart`);
 }
 evidence.status='PASS';
}finally{
 writeFileSync(join(evidenceHome,'windows.json'),JSON.stringify(evidence,null,2)+'\n');
}
console.log(JSON.stringify(evidence,null,2));
