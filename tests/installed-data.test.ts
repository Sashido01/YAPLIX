import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

test('installed storage survives reopening outside the application and refuses path escape',()=>{
 const home=mkdtempSync(resolve('.local/install-data-test-'));
 try{
  const result=spawnSync(process.execPath,['--input-type=module','-e',`
   import assert from 'node:assert/strict';
   import {resolve} from 'node:path';
   import {Store,managedPath} from './src/store.ts';
   import {runtimeKey} from './src/runtime-control.ts';
   assert.equal(managedPath('.local/data/yaplix.sqlite'),resolve(process.env.YAPLIX_DATA_HOME,'data/yaplix.sqlite'));
   const first=new Store();assert.equal(first.integrity(),true);first.close();
   const key=runtimeKey();const second=new Store();assert.equal(second.integrity(),true);second.close();
   assert.equal(runtimeKey(),key);
   assert.throws(()=>managedPath('.local/../../escape.sqlite'));
  `],{env:{...process.env,YAPLIX_DATA_HOME:home},encoding:'utf8'});
  assert.ifError(result.error);assert.equal(result.status,0,result.stderr);
  assert.equal(existsSync(resolve(home,'data/yaplix.sqlite')),true);
 }finally{rmSync(home,{recursive:true,force:true});}
});
