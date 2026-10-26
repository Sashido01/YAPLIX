import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,symlinkSync,readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
test('desktop command reports stopped without npm or touching repository data',()=>{
 const home=mkdtempSync(resolve('.local/desktop-test-'));
 try{
  const env:NodeJS.ProcessEnv={...process.env,YAPLIX_DATA_HOME:home};delete env.NODE_TEST_CONTEXT;
  const result=spawnSync(process.execPath,['scripts/desktop.mjs','--status'],{env,encoding:'utf8'});
  assert.ifError(result.error);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/stopped/);
 }finally{rmSync(home,{recursive:true,force:true});}
});

test('desktop starts once, reopens, saves a game and preserves it after full stop', {timeout:60000}, async()=>{
 const {createServer}=await import('node:net');
 const {readFileSync,existsSync}=await import('node:fs');
 const {setTimeout:delay}=await import('node:timers/promises');
 const home=mkdtempSync(resolve('.local/desktop-cycle-'));
 const env:NodeJS.ProcessEnv={...process.env,YAPLIX_DATA_HOME:home};delete env.NODE_TEST_CONTEXT;
 for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete env[key];
 const command=(...args:string[])=>{const r=spawnSync(process.execPath,['scripts/desktop.mjs',...args,'--no-open'],{env,encoding:'utf8',timeout:35000});assert.ifError(r.error);assert.equal(r.status,0,r.stderr);return r.stdout;};
 const busy=createServer();await new Promise<void>((done,fail)=>{busy.once('error',(e:NodeJS.ErrnoException)=>e.code==='EADDRINUSE'?done():fail(e));busy.listen(3000,'127.0.0.1',done);});
 const state=()=>JSON.parse(readFileSync(resolve(home,'desktop.json'),'utf8'));
 const stopped=async()=>{command('--stop');for(let i=0;i<80&&existsSync(resolve(home,'desktop.lock'));i++)await delay(100);assert.equal(existsSync(resolve(home,'desktop.lock')),false);};
 try{
  assert.match(command(),/running/);const first=state();assert.notEqual(first.port,3000);
  const base='http://127.0.0.1:'+first.port;
  assert.equal((await fetch(base+'/healthz',{headers:{Connection:'close'}})).status,200);
  assert.match(command(),/running/);assert.equal(state().instance,first.instance);
  const saved=await fetch(base+'/api/gallery/prism-maze',{method:'POST',headers:{'Content-Type':'application/json',Connection:'close'},body:'{}'});assert.equal(saved.status,201);const version=await saved.json();
  await stopped();assert.match(command('--status'),/stopped/);
  command();const second=state();assert.notEqual(second.instance,first.instance);
  const reopened=await(await fetch('http://127.0.0.1:'+second.port+'/api/versions/'+version.versionId,{headers:{Connection:'close'}})).json();assert.equal(reopened.html,version.html);
 }finally{await stopped();await new Promise<void>(done=>busy.close(()=>done()));rmSync(home,{recursive:true,force:true});}
});


test('AI dialog saves OpenRouter settings privately and configures the existing route', {timeout:60000}, async()=>{
 const {readFileSync,statSync,existsSync}=await import('node:fs');
 const {setTimeout:delay}=await import('node:timers/promises');
 const home=mkdtempSync(resolve('.local/desktop-settings-')),bin=resolve(home,'bin');mkdirSync(bin);
 writeFileSync(resolve(bin,'zenity'),"#!/bin/sh\ncase \"$1\" in --list) echo 'OpenRouter Free';; --password) echo 'fixture-key-install-test';; *) exit 1;; esac\n",{mode:0o700});
 const env:NodeJS.ProcessEnv={...process.env,YAPLIX_DATA_HOME:home,PATH:bin+':'+process.env.PATH};delete env.NODE_TEST_CONTEXT;
 const command=(...args:string[])=>{const r=spawnSync(process.execPath,['scripts/desktop.mjs',...args,'--no-open'],{env,encoding:'utf8',timeout:35000});assert.ifError(r.error);assert.equal(r.status,0,r.stderr);};
 try{
  command('--settings');assert.equal(statSync(resolve(home,'providers.json')).mode&0o777,0o600);
  command();const {port}=JSON.parse(readFileSync(resolve(home,'desktop.json'),'utf8'));
  const response=await fetch('http://127.0.0.1:'+port+'/api/providers',{headers:{Connection:'close'}});const data=await response.json();
  assert.equal(data.providers.find((p:{mode:string})=>p.mode==='openrouter').configured,true);
 }finally{command('--stop');for(let i=0;i<100&&existsSync(resolve(home,'desktop.lock'));i++)await delay(100);rmSync(home,{recursive:true,force:true});}
});

test('desktop refuses a linked journal without changing its target or showing a stack',()=>{
 const home=mkdtempSync(resolve('.local/desktop-link-'));
 try{
  const target=resolve(home,'preserve.txt');writeFileSync(target,'preserve');symlinkSync(target,resolve(home,'desktop.log'));
  const env:NodeJS.ProcessEnv={...process.env,YAPLIX_DATA_HOME:home};delete env.NODE_TEST_CONTEXT;
  const r=spawnSync(process.execPath,['scripts/desktop.mjs','--status','--no-open'],{env,encoding:'utf8'});
  assert.ifError(r.error);assert.equal(r.status,1);assert.equal(readFileSync(target,'utf8'),'preserve');
  assert.match(r.stderr,/Не удалось/);assert.doesNotMatch(r.stderr,/at file:|Error: DATA_LINK/);
 }finally{rmSync(home,{recursive:true,force:true});}
});

test('two independent profiles start concurrently on distinct ports', {timeout:60000}, async()=>{
 const {spawn}=await import('node:child_process');
 const {createHash}=await import('node:crypto');
 const {setTimeout:delay}=await import('node:timers/promises');
 const base=mkdtempSync(resolve('.local/desktop-parallel-'));
 const portStart=(path:string)=>createHash('sha256').update(path).digest().readUInt32BE(0)%20;
 const first=resolve(base,'profile-one');let second='';
 for(let i=0;i<100;i++){const candidate=resolve(base,'profile-two-'+i);if(portStart(candidate)===portStart(first)){second=candidate;break;}}
 assert.ok(second,'could not make a deterministic same-port fixture');
 const homes=[first,second];
 for(const home of homes)mkdirSync(home,{recursive:true});
 const run=(home:string)=>new Promise<{code:number|null;out:string;err:string}>((done)=>{
  const env:NodeJS.ProcessEnv={...process.env,YAPLIX_DATA_HOME:home};delete env.NODE_TEST_CONTEXT;
  for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete env[key];
  const child=spawn(process.execPath,['scripts/desktop.mjs','--no-open'],{env});let out='',err='';
  child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);
  child.once('close',code=>done({code,out,err}));
 });
 const stop=async(home:string)=>{
  const env:NodeJS.ProcessEnv={...process.env,YAPLIX_DATA_HOME:home};delete env.NODE_TEST_CONTEXT;
  const result=spawnSync(process.execPath,['scripts/desktop.mjs','--stop','--no-open'],{env,encoding:'utf8',timeout:20000});
  assert.ifError(result.error);assert.equal(result.status,0,result.stderr);
  for(let i=0;i<80&&existsSync(resolve(home,'desktop.lock'));i++)await delay(100);
 };
 try{
  const results=await Promise.all(homes.map(run));
  assert.deepEqual(results.map(result=>result.code),[0,0],JSON.stringify(results));
  const ports=results.map(result=>Number(result.out.match(/running (\d+)/)?.[1]));
  assert.ok(ports.every(Number.isInteger),JSON.stringify(results));assert.notEqual(ports[0],ports[1]);
  for(const port of ports)assert.equal((await fetch('http://127.0.0.1:'+port+'/healthz',{headers:{Connection:'close'}})).status,200);
 }finally{await Promise.all(homes.map(stop));rmSync(base,{recursive:true,force:true});}
});
