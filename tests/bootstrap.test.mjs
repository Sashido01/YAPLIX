import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

test('Ubuntu bootstrap rejects a corrupt offline Node archive before execution',()=>{
 const home=mkdtempSync(join(tmpdir(),'yaplix-bootstrap-'));
 try{
  const archive=join(home,'node-v24.18.0-linux-x64.tar.xz');
  writeFileSync(archive,'not a Node distribution');
  const run=spawnSync('bash',[resolve('install.sh'),'--runtime-only'],{
   cwd:resolve('.'),encoding:'utf8',timeout:10000,
   env:{...process.env,YAPLIX_BOOTSTRAP_HOME:join(home,'tools'),YAPLIX_BOOTSTRAP_ARCHIVE:archive}
  });
  assert.equal(run.status,1,run.stderr);
  assert.match(run.stderr,/SHA256/);
  assert.equal(existsSync(join(home,'tools','node-v24.18.0-linux-x64')),false);
 }finally{rmSync(home,{recursive:true,force:true});}
});

test('source plan without Chrome and browser cache explains the offline Full package route',()=>{
 const home=mkdtempSync(join(tmpdir(),'yaplix-source-plan-'));
 try{
  const run=spawnSync(process.execPath,[resolve('scripts/install-source.mjs'),'--plan','--test-no-chrome','--test-profile',join(home,'profile')],{
   cwd:resolve('.'),encoding:'utf8',timeout:10000,
   env:{...process.env,YAPLIX_BOOTSTRAP_HOME:join(home,'tools'),YAPLIX_INSTALL_OFFLINE:'1',PLAYWRIGHT_BROWSERS_PATH:join(home,'missing-browsers')}
  });
  assert.equal(run.status,1,run.stderr);
  assert.match(run.stdout,/"mode":\s*"full"/);
  assert.match(run.stderr,/готовый Full-пакет/);
 }finally{rmSync(home,{recursive:true,force:true});}
});

test('source plan preserves a damaged browser cache and names the damage',()=>{
 const home=mkdtempSync(join(tmpdir(),'yaplix-damaged-browser-'));
 try{
  const cache=join(home,'browsers');mkdirSync(join(cache,'chromium-1248'),{recursive:true});
  writeFileSync(join(cache,'chromium-1248','chrome'),'damaged');
  const run=spawnSync(process.execPath,[resolve('scripts/install-source.mjs'),'--plan','--test-no-chrome','--test-profile',join(home,'profile')],{
   cwd:resolve('.'),encoding:'utf8',timeout:10000,
   env:{...process.env,YAPLIX_BOOTSTRAP_HOME:join(home,'tools'),YAPLIX_INSTALL_OFFLINE:'1',PLAYWRIGHT_BROWSERS_PATH:cache}
  });
  assert.equal(run.status,1,run.stderr);
  assert.match(run.stderr,/кэш браузера повреждён/);
  assert.equal(existsSync(join(cache,'chromium-1248','chrome')),true);
 }finally{rmSync(home,{recursive:true,force:true});}
});

test('source payload includes every local runtime script dependency',()=>{
 const source=readFileSync('scripts/install-source.mjs','utf8');
 const list=source.match(/const runtimeScripts=\[([^\]]+)\]/);
 assert.ok(list,'source installer must declare its reviewed runtime scripts');
 const names=[...list[1].matchAll(/'([^']+)'/g)].map(match=>match[1]);
 for(const name of names){
  if(!/\.(mjs|ts)$/.test(name))continue;
  const code=readFileSync('scripts/'+name,'utf8');
  for(const dependency of code.matchAll(/from\s*['"]\.\/([^'"]+)['"]/g))
   assert.ok(names.includes(dependency[1]),`${name} imports missing payload script ${dependency[1]}`);
 }
});
