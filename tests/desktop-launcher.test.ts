import test from 'node:test';
import {Store} from '../src/store.ts';
import {artifact,spec} from './helpers.ts';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,symlinkSync,readFileSync,existsSync,readdirSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
const isolatedProfile=(prefix:string)=>{const home=mkdtempSync(resolve('.local',prefix));writeFileSync(resolve(home,'.env'),'# isolated desktop test; no provider credentials\n',{mode:0o600});return home;};
const desktopEnv=(home:string,extra:NodeJS.ProcessEnv={})=>{const env:NodeJS.ProcessEnv={...process.env,...extra,YAPLIX_DATA_HOME:home};delete env.NODE_TEST_CONTEXT;for(const key of ['OLLAMA_API_KEY','OLLAMA_CLOUD_API_KEY','CLOUD_API_KEY','OPENAI_API_KEY','CHATGPT_ACCESS_TOKEN','CHATGPT_REFRESH_TOKEN','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete env[key];return env;};
const stopBestEffort=(home:string)=>{try{spawnSync(process.execPath,['scripts/desktop.mjs','--stop','--no-open'],{env:desktopEnv(home),encoding:'utf8',timeout:20000});}catch{}};
test('desktop command reports stopped without npm or touching repository data',()=>{
 const home=isolatedProfile('desktop-test-');
 try{
  const env=desktopEnv(home);
  const result=spawnSync(process.execPath,['scripts/desktop.mjs','--status'],{env,encoding:'utf8'});
  assert.ifError(result.error);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/stopped/);
 }finally{rmSync(home,{recursive:true,force:true});}
});

test('desktop starts once, reopens, saves a game and preserves it after full stop', {timeout:60000}, async()=>{
 const {createServer}=await import('node:net');
 const {readFileSync,existsSync}=await import('node:fs');
 const {setTimeout:delay}=await import('node:timers/promises');
 const home=isolatedProfile('desktop-cycle-');
 const env=desktopEnv(home);
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
  const setup=new Store(resolve(home,'data/yaplix.sqlite'));const version=setup.save(spec,artifact);setup.close();
  await stopped();assert.match(command('--status'),/stopped/);
  command();const second=state();assert.notEqual(second.instance,first.instance);
  const reopened=await(await fetch('http://127.0.0.1:'+second.port+'/api/versions/'+version.versionId,{headers:{Connection:'close'}})).json();assert.equal(reopened.html,version.html);
  const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(resolve(home,'data/yaplix.sqlite'),{readOnly:true});
  try{assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check,'ok');assert.equal(db.prepare('SELECT html FROM versions WHERE version_id=?').get(version.versionId)?.html,version.html);}finally{db.close();}
  const traceDir=resolve(home,'diagnostics/operations'),rows=readdirSync(traceDir).filter(name=>/^[0-9a-f-]{36}\.jsonl$/.test(name)).flatMap(name=>readFileSync(resolve(traceDir,name),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)));
  const events=new Set(rows.map(row=>row.event));for(const event of ['desktop.started','desktop.backend_ready','desktop.instance_reused','desktop.stop_requested','desktop.stopped','desktop.restart'])assert.ok(events.has(event),`missing ${event}`);
  assert.ok(rows.every(row=>row.operationId&&Number.isFinite(Date.parse(row.timestamp))&&row.stage&&row.status));
  assert.equal(statSync(traceDir).mode&0o777,0o700);assert.ok(readdirSync(traceDir).every(name=>(statSync(resolve(traceDir,name)).mode&0o777)===0o600));
  await stopped();
 }finally{stopBestEffort(home);await new Promise<void>(done=>busy.close(()=>done()));rmSync(home,{recursive:true,force:true});}
});


test('AI dialog saves OpenRouter settings privately and configures the existing route', {timeout:60000}, async()=>{
 const {readFileSync,statSync,existsSync}=await import('node:fs');
 const {setTimeout:delay}=await import('node:timers/promises');
 const home=isolatedProfile('desktop-settings-'),bin=resolve(home,'bin');mkdirSync(bin);
 writeFileSync(resolve(bin,'zenity'),"#!/bin/sh\ncase \"$1\" in --list) echo 'OpenRouter Free';; --password) echo 'fixture-key-install-test';; *) exit 1;; esac\n",{mode:0o700});
 const env=desktopEnv(home,{PATH:bin+':'+process.env.PATH});
 const command=(...args:string[])=>{const r=spawnSync(process.execPath,['scripts/desktop.mjs',...args,'--no-open'],{env,encoding:'utf8',timeout:35000});assert.ifError(r.error);assert.equal(r.status,0,r.stderr);};
 try{
  command('--settings');assert.equal(statSync(resolve(home,'providers.json')).mode&0o777,0o600);
  command();const {port}=JSON.parse(readFileSync(resolve(home,'desktop.json'),'utf8'));
  const response=await fetch('http://127.0.0.1:'+port+'/api/providers',{headers:{Connection:'close'}});const data=await response.json();
  assert.equal(data.providers.find((p:{mode:string})=>p.mode==='openrouter').configured,true);
 }finally{stopBestEffort(home);rmSync(home,{recursive:true,force:true});}
});

test('desktop refuses a linked journal without changing its target or showing a stack',()=>{
 const home=isolatedProfile('desktop-link-');
 try{
  const target=resolve(home,'preserve.txt');writeFileSync(target,'preserve');symlinkSync(target,resolve(home,'desktop.log'));
  const env=desktopEnv(home);
  const r=spawnSync(process.execPath,['scripts/desktop.mjs','--status','--no-open'],{env,encoding:'utf8'});
  assert.ifError(r.error);assert.equal(r.status,1);assert.equal(readFileSync(target,'utf8'),'preserve');
  assert.match(r.stderr,/Не удалось/);assert.doesNotMatch(r.stderr,/at file:|Error: DATA_LINK/);
 }finally{rmSync(home,{recursive:true,force:true});}
});

test('desktop shutdown leaves a lock whose PID belongs to another live process',()=>{
 const home=isolatedProfile('desktop-foreign-lock-'),env=desktopEnv(home);
 const command=(...args:string[])=>spawnSync(process.execPath,['scripts/desktop.mjs',...args,'--no-open'],{env,encoding:'utf8',timeout:35000});
 try{
  const started=command();assert.ifError(started.error);assert.equal(started.status,0,started.stderr);
  const lock=resolve(home,'desktop.lock');writeFileSync(lock,JSON.stringify({pid:process.pid}),{mode:0o600});
  const stopped=command('--stop');assert.ifError(stopped.error);assert.equal(stopped.status,1);
  assert.deepEqual(JSON.parse(readFileSync(lock,'utf8')),{pid:process.pid});
  assert.equal(existsSync(resolve(home,'desktop.json')),false);
 }finally{stopBestEffort(home);rmSync(home,{recursive:true,force:true});}
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
 for(const home of homes){mkdirSync(home,{recursive:true,mode:0o700});writeFileSync(resolve(home,'.env'),'# isolated concurrent desktop test\n',{mode:0o600});}
 const run=(home:string)=>new Promise<{code:number|null;out:string;err:string}>((done)=>{
  const env=desktopEnv(home);
  for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete env[key];
  const child=spawn(process.execPath,['scripts/desktop.mjs','--no-open'],{env});let out='',err='';
  child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);
  child.once('close',code=>done({code,out,err}));
 });
 const stop=async(home:string)=>{
  const env=desktopEnv(home);
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
  await Promise.all(homes.map(stop));
 }finally{for(const home of homes)stopBestEffort(home);rmSync(base,{recursive:true,force:true});}
});
