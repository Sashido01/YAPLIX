import {spawnSync} from 'node:child_process';
import {access,constants} from 'node:fs/promises';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
process.env.PLAYWRIGHT_BROWSERS_PATH??=new URL('../.local/playwright',import.meta.url).pathname;
const {chromium}=await import('@playwright/test');

const mode=process.argv[2];
if(!['quick','integration','full'].includes(mode))throw Error('USAGE: node scripts/check.mjs quick|integration|full');
const root=new URL('../',import.meta.url),cwd=root.pathname.replace(/\/$/,'');
const started=Date.now(),result=[];
const run=(name,command,args)=>{
  console.log(`\n[${mode}] ${name}`);const before=Date.now();
  const env={...process.env};
  if(mode==='full'&&(args.includes('test')||args.includes('test:browser')))
    for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete env[key];
  const child=spawnSync(command,args,{cwd,stdio:'inherit',env});
  const row={name,status:child.error?'FAIL':child.status===0?'PASS':'FAIL',durationMs:Date.now()-before};result.push(row);
  if(child.error)console.error(child.error.message);return child.error?1:child.status??1;
};
const preflight=async()=>{
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major!==24||minor<18)throw Error(`NODE_UNSUPPORTED:${process.versions.node}`);
  const binary=chromium.executablePath();await access(binary,constants.X_OK);
  const port=Number(process.env.YAPLIX_PLAY_PORT??3210),probe=createServer();
  await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(port,'127.0.0.1',resolve);});
  await new Promise(resolve=>probe.close(resolve));
  if(process.env.YAPLIX_PLAY_DB&&process.env.YAPLIX_PLAY_DB!==':memory:')throw Error('TEST_DB_NOT_ISOLATED');
  await access(new URL('../src/browser-temp.ts',import.meta.url));
  const child=spawn(process.execPath,['tests/browser-server.ts'],{cwd,env:{...process.env,YAPLIX_PLAY_PORT:String(port),YAPLIX_PLAY_DB:':memory:'},stdio:'ignore'});
  try{
    const deadline=Date.now()+6000;let ready=false;
    while(Date.now()<deadline){if(child.exitCode!==null)throw Error('TEST_SERVER_EXITED');try{const health=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(300)});if(health.ok){const shell=await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(300)});if(shell.ok){ready=true;break;}}}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
    if(!ready)throw Error('TEST_SERVER_NOT_READY');
  }finally{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}}
  console.log(`PREFLIGHT PASS node=${process.versions.node} chromium=${binary} isolatedTestServer=ready port=${port}`);
};
let failed=false;
try{await preflight();}catch(error){console.error(`PREFLIGHT FAIL: ${error instanceof Error?error.message:String(error)}`);console.error('SKIPPED_DEPENDENCY_FAILURE: browser-dependent suites were not started.');process.exitCode=1;process.exit();}
const npm=(...args)=>run(args.join(' '),'npm',args);
const node=(name,...args)=>run(name,process.execPath,args);
const python=(name,...args)=>run(name,'python3',args);
if(npm('run','typecheck'))failed=true;
if(!failed&&npm('run','build'))failed=true;
if(!failed&&mode==='quick'){
  if(node('focused unit/API contracts','--test','tests/no-demo.test.ts','tests/arena.test.ts'))failed=true;
  if(!failed&&node('short Chromium user-flow smoke','scripts/browser-tests.mjs','test','tests/mvp.spec.ts','--project=chromium-desktop'))failed=true;
}
if(!failed&&mode==='integration'){
  if(node('targeted API, Arena and generation contracts','--test','tests/no-demo.test.ts','tests/arena.test.ts','tests/engine.test.ts'))failed=true;
  for(const project of ['chromium-desktop','chromium-320','chromium-390']){
    if(failed)break;
    if(project==='chromium-desktop'){
      if(node('desktop create/edit/export MVP smoke','scripts/browser-tests.mjs','test','tests/mvp.spec.ts','--project=chromium-desktop'))failed=true;
      if(!failed&&node('desktop touch/rotation state smoke','scripts/browser-tests.mjs','test','tests/mobile.spec.ts','--grep=touch,\\ rotation','--project=chromium-desktop'))failed=true;
    }else if(node(`responsive touch/rotation smoke ${project}`,'scripts/browser-tests.mjs','test','tests/mobile.spec.ts','--grep=touch,\\ rotation',`--project=${project}`))failed=true;
  }
}
if(!failed&&mode==='full'){
  if(npm('test'))failed=true;
  if(!failed&&npm('run','test:browser'))failed=true;
  if(!failed&&python('repository convention checks','scripts/check_repo.py'))failed=true;
  if(!failed&&python('repository convention unit tests','-m','unittest','discover','-s','scripts/tests'))failed=true;
  if(!failed&&node('secret scan','scripts/secret-scan.mjs'))failed=true;
}
if(run('git diff whitespace check','git',['diff','--check']))failed=true;
console.log(`\n${mode.toUpperCase()} ${failed?'FAIL':'PASS'} totalMs=${Date.now()-started}`);
for(const row of result)console.log(`${row.status} ${row.name} ${row.durationMs}ms`);
process.exitCode=failed?1:0;
