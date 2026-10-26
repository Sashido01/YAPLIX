import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
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
