import test from 'node:test';
import assert from 'node:assert/strict';
import {runInstallation} from '../scripts/install-engine.mjs';

test('installer refuses incompatible OS before installing anything',async()=>{
 let installs=0;
 const adapter={check:async()=>({supported:false,code:'UNSUPPORTED_OS'}),install:async()=>{installs++;}};
 await assert.rejects(runInstallation(adapter),{code:'UNSUPPORTED_OS'});
 assert.equal(installs,0);
});

const facts={supported:true,integrity:true,dataIntegrity:true,writable:true,freeBytes:5000,requiredBytes:100,currentSame:false,dependencies:[],needsNetwork:false,online:false};
function fixture(overrides={}){
 const calls=[];
 return {calls,check:async()=>facts,prepare:async()=>({rollback:true}),install:async()=>calls.push('install'),verify:async()=>({apiReady:true,uiReady:true,sandboxReady:true}),launch:async()=>({url:'http://127.0.0.1:3001/'}),rollback:async()=>calls.push('rollback'),commit:async()=>calls.push('commit'),...overrides};
}
test('complete isolated offline installation requires real readiness and no administrator',async()=>{
 const a=fixture(),stages=[];const r=await runInstallation(a,s=>stages.push(s.stage));
 assert.deepEqual(stages,['CHECK','PLAN','PREPARE','INSTALL','VERIFY','LAUNCH','DONE']);assert.equal(r.plan.requiresAdmin,false);assert.deepEqual(a.calls,['install','commit']);
});
test('a zero exit installation without protected sandbox cannot replace the working version',async()=>{
 const a=fixture({verify:async()=>({apiReady:true,uiReady:true,sandboxReady:false})});
 await assert.rejects(runInstallation(a),{code:'VERIFY'});assert.deepEqual(a.calls,['install','rollback']);
});

test('Lite protected Chrome failure returns the Full fallback and rolls back',async()=>{
 const {InstallError,messages}=await import('../scripts/install-engine.mjs');
 const a=fixture({verify:async()=>{throw new InstallError('LITE_BROWSER');}});
 await assert.rejects(runInstallation(a),{code:'LITE_BROWSER'});
 assert.match(messages.LITE_BROWSER,/полный установщик/);
 assert.deepEqual(a.calls,['install','rollback']);
});
test('compatible installed components are reused without installing again',async()=>{
 const a=fixture({check:async()=>({...facts,currentSame:true})});
 assert.equal((await runInstallation(a)).plan.action,'reuse');assert.deepEqual(a.calls,['commit']);
});
test('broken user data, insufficient space and write permissions stop before installation',async()=>{
 for(const [change,code] of [[{dataIntegrity:false},'DATA_INTEGRITY'],[{freeBytes:10},'SPACE'],[{writable:false},'PERMISSION']]){
  const a=fixture({check:async()=>({...facts,...change})});await assert.rejects(runInstallation(a),{code});assert.deepEqual(a.calls,[]);
 }
});

test('payload integrity rejects corruption and paths outside the application',async()=>{
 const {verifyFiles}=await import('../scripts/install-adapter.mjs');
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');const {resolve}=await import('node:path');
 const root=mkdtempSync(resolve('.local/install-002/integrity-'));
 try{
  writeFileSync(resolve(root,'test.txt'),'changed');writeFileSync(resolve(root,'integrity.json'),JSON.stringify({'test.txt':'0'.repeat(64)}));assert.throws(()=>verifyFiles(root),{code:'INTEGRITY'});
  writeFileSync(resolve(root,'integrity.json'),JSON.stringify({'../outside':'0'.repeat(64)}));assert.throws(()=>verifyFiles(root),{code:'INTEGRITY'});
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('interrupted update restores only the previous program pointer and preserves user bytes',async()=>{
 const {createAdapter,sha}=await import('../scripts/install-adapter.mjs');
 const fs=await import('node:fs');const {resolve,join}=await import('node:path');
 const root=fs.mkdtempSync(resolve('.local/install-002/recover-'));
 try{
  const source=join(root,'source');fs.mkdirSync(source);fs.writeFileSync(join(source,'app.txt'),'previous working program');fs.writeFileSync(join(source,'integrity.json'),JSON.stringify({'app.txt':sha(Buffer.from('previous working program'))}));
  const id=sha(fs.readFileSync(join(source,'integrity.json'))),program=join(root,'program'),data=join(root,'data');
  const adapter=createAdapter({source,installHome:program,dataHome:data,menuHome:join(root,'menu')});
  fs.mkdirSync(join(program,'versions'),{recursive:true});fs.cpSync(source,join(program,'versions',id),{recursive:true});
  fs.writeFileSync(join(program,'current.json'),JSON.stringify({id:'a'.repeat(64)}));
  fs.writeFileSync(join(program,'installer/transaction.json'),JSON.stringify({previous:id,candidate:'a'.repeat(64)}));
  fs.writeFileSync(join(data,'preserve.sqlite'),'test bytes, not opened as a database');
  assert.equal(await adapter.recover(),true);assert.equal(JSON.parse(fs.readFileSync(join(program,'current.json'),'utf8')).id,id);
  assert.equal(fs.readFileSync(join(data,'preserve.sqlite'),'utf8'),'test bytes, not opened as a database');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('filesystem permission and space errors produce concrete safe recovery messages',async()=>{
 for(const [osCode,code] of [['EACCES','PERMISSION'],['EROFS','PERMISSION'],['ENOSPC','SPACE']]){
  const a=fixture({check:async()=>{throw Object.assign(new Error('private-path-and-secret'),{code:osCode});}});
  await assert.rejects(runInstallation(a),{code,message:code});assert.deepEqual(a.calls,[]);
 }
});
