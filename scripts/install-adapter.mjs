// Per-user files only. No apt, sudo/pkexec, services, OS settings or public listener.
import {existsSync,readFileSync,writeFileSync,mkdirSync,lstatSync,statfsSync,statSync,renameSync,cpSync,rmSync,mkdtempSync,readdirSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute,join} from 'node:path';
import {homedir,release,tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {InstallError} from './install-engine.mjs';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function privateDirectory(path){
 if(!isAbsolute(path))throw new InstallError('PERMISSION');
 for(let p=path;;p=dirname(p)){try{if(lstatSync(p).isSymbolicLink())throw new InstallError('PERMISSION');}catch(e){if(e.code!=='ENOENT')throw e;}if(dirname(p)===p)break;}
 mkdirSync(path,{recursive:true,mode:0o700});
}
export function verifyFiles(root){
 const manifestFile=resolve(root,'integrity.json');if(lstatSync(manifestFile).isSymbolicLink())throw new InstallError('INTEGRITY');
 const manifest=JSON.parse(readFileSync(manifestFile,'utf8'));
 let bytes=0;
 for(const [name,hash] of Object.entries(manifest)){
  const file=resolve(root,name),rel=relative(root,file);
  if(!rel||rel.startsWith('..')||isAbsolute(rel))throw new InstallError('INTEGRITY');
  for(let p=file;p!==root;p=dirname(p))if(lstatSync(p).isSymbolicLink())throw new InstallError('INTEGRITY');
  const content=readFileSync(file);if(sha(content)!==hash)throw new InstallError('INTEGRITY');bytes+=content.length;
 }
 return {id:sha(readFileSync(resolve(root,'integrity.json'))),bytes,manifest};
}
function readJSON(path){try{return JSON.parse(readFileSync(path,'utf8'));}catch{return null;}}
function safeFile(path){if(existsSync(path)){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw new InstallError('PERMISSION');}}
function atomicJSON(path,value){safeFile(path);const t=path+'.'+process.pid+'.tmp';writeFileSync(t,JSON.stringify(value),{mode:0o600,flag:'wx'});renameSync(t,path);}
function processEnv(root,dataHome){
 const env={...process.env,YAPLIX_DATA_HOME:dataHome,PLAYWRIGHT_BROWSERS_PATH:resolve(root,'browsers'),LD_LIBRARY_PATH:resolve(root,'lib'),LIVE_PROVIDER:'none',OLLAMA_CLOUD_API_KEY:'',CLOUD_API_KEY:'',TELEGRAM_BOT_TOKEN:'',TELEGRAM_UPDATES:'off'};
 delete env.CHROME_DEVEL_SANDBOX;
 return env;
}
function command(root,args,dataHome){
 const r=spawnSync(resolve(root,'runtime',process.platform==='win32'?'node.exe':'node'),[resolve(root,'scripts/desktop.mjs'),...args,'--no-open'],{env:processEnv(root,dataHome),encoding:'utf8',timeout:40000,windowsHide:true});
 if(r.error||r.status!==0)throw new InstallError('START');return r.stdout;
}
async function dbInfo(home){
 const file=resolve(home,'data/yaplix.sqlite');if(!existsSync(file))return {exists:false,integrity:true};
 // Read-only integrity: never opens Store or runs migration during CHECK.
 const {DatabaseSync}=await import('node:sqlite');let db;
 try{for(let part=file;part!==home;part=dirname(part))if(lstatSync(part).isSymbolicLink())return {exists:true,integrity:false};db=new DatabaseSync(file,{readOnly:true});return {exists:true,integrity:db.prepare('PRAGMA quick_check').get()?.quick_check==='ok',schema:Number(db.prepare('PRAGMA user_version').get()?.user_version)};}catch{return {exists:true,integrity:false};}finally{db?.close();}
}
export function createAdapter(options){
 const source=resolve(options.source),dataHome=resolve(options.dataHome??(process.platform==='win32'?join(process.env.LOCALAPPDATA??homedir(),'YAPLIX'):join(process.env.XDG_DATA_HOME??join(homedir(),'.local/share'),'yaplix')));
 const installHome=resolve(options.installHome??(process.platform==='win32'?join(process.env.LOCALAPPDATA??homedir(),'Programs/YAPLIX'):join(process.env.XDG_DATA_HOME??join(homedir(),'.local/share'),'yaplix-program')));
 const menuHome=resolve(options.menuHome??join(process.env.XDG_DATA_HOME??join(homedir(),'.local/share'),'applications'));
 privateDirectory(installHome);privateDirectory(dataHome);
 const stateHome=join(installHome,'installer');privateDirectory(stateHome);
 const pointer=join(installHome,'current.json'),transaction=join(stateHome,'transaction.json');
 const delivery=readJSON(join(source,'packaging/delivery.json'));
 const info=verifyFiles(source),candidate=join(installHome,'versions',info.id);
 const current=()=>{const p=readJSON(pointer);return p&&/^[a-f0-9]{64}$/.test(p.id)?join(installHome,'versions',p.id):null;};
 let old=current(),probeHome,started=false;
 const log=row=>{try{const path=join(stateHome,'install.log');safeFile(path);if(existsSync(path)&&statSync(path).size>65536)writeFileSync(path,'',{mode:0o600});writeFileSync(path,new Date().toISOString()+' '+row.stage+' '+row.code+'\n',{flag:'a',mode:0o600});}catch{}};
 async function stop(root,home){if(!root)return;try{command(root,['--stop'],home);}catch{}const lock=join(home,'desktop.lock');for(let i=0;i<30&&existsSync(lock);i++)await delay(100);if(existsSync(lock)){try{const {pid}=JSON.parse(readFileSync(lock,'utf8'));if(Number.isInteger(pid)&&pid>0){try{process.kill(pid,'SIGTERM');}catch{}for(let i=0;i<15&&existsSync(lock);i++)await delay(100);try{process.kill(pid,'SIGKILL');}catch{}}}catch{}try{rmSync(lock,{force:true});rmSync(join(home,'desktop.json'),{force:true});}catch{}}}
 async function recover(){
  for(const name of readdirSync(stateHome).filter(n=>/^probe-[a-zA-Z0-9]+$/.test(n))){
   const dir=join(stateHome,name),owner=readJSON(join(dir,'installer-owner.json'));
   if(!/^[a-f0-9]{64}$/.test(owner?.id??''))continue;
   const program=join(installHome,'versions',owner.id);
   if(existsSync(program)){verifyFiles(program);await stop(program,dir);rmSync(dir,{recursive:true});}
  }
  const tx=readJSON(transaction);if(!tx)return;
  if(!/^[a-f0-9]{64}$/.test(tx.candidate??'')||!(tx.previous===null||/^[a-f0-9]{64}$/.test(tx.previous??'')))throw new InstallError('INTEGRITY');
  // Candidate directories are immutable once complete. Never delete user DBs.
  const interrupted=join(installHome,'versions',tx.candidate);
  if(existsSync(interrupted)){verifyFiles(interrupted);await stop(interrupted,dataHome);}
  const previous=tx.previous?join(installHome,'versions',tx.previous):null;
  if(previous){verifyFiles(previous);await shortcuts(previous);atomicJSON(pointer,{id:tx.previous});old=previous;}
  rmSync(transaction);return true;
 }
 async function shortcuts(root){
  if(process.platform==='win32'){
   const args=['-NoProfile','-File',join(source,'packaging/install-shortcuts.ps1'),'-Root',root];
   if(options.menuHome)args.push('-MenuHome',menuHome);
   const r=spawnSync('powershell.exe',args,{encoding:'utf8',windowsHide:true});if(r.error||r.status!==0)throw new InstallError('PERMISSION');return;
  }
  privateDirectory(menuHome);
  for(const [name,title,args] of [['yaplix','YAPLIX',''],['yaplix-stop','Остановить YAPLIX','--stop'],['yaplix-settings','Настроить AI YAPLIX','--settings'],['yaplix-logs','Журнал YAPLIX','--logs']]){
   const quote=x=>'"'+x.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('`','\\`').replaceAll('$','\\$').replaceAll('%','%%')+'"';
   const content='[Desktop Entry]\nType=Application\nName='+title+'\nExec='+quote(join(root,'runtime/node'))+' '+quote(join(root,'scripts/desktop.mjs'))+' '+args+'\nIcon='+join(root,'packaging/yaplix.svg')+'\nTerminal=false\nCategories=Game;\n';
   const file=join(menuHome,name+'.desktop'),temp=file+'.'+process.pid+'.tmp';writeFileSync(temp,content,{mode:0o600});renameSync(temp,file);
  }
 }
 return {source,dataHome,installHome,stateHome,log,
  async check(){
   verifyFiles(source);
   const os=process.platform==='linux'?Object.fromEntries(readFileSync('/etc/os-release','utf8').split('\n').filter(x=>x.includes('=')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1).replace(/^"|"$/g,'')];})):{};
   const supported=process.arch==='x64'&&(process.platform==='linux'?os.ID==='ubuntu'&&os.VERSION_ID==='24.04':process.platform==='win32'&&Number(release().split('.')[0])>=10);
   const runtime=spawnSync(join(source,'runtime',process.platform==='win32'?'node.exe':'node'),['--version'],{encoding:'utf8'});
   if(runtime.error||runtime.status!==0||!/^v24\.(?:1[89]|[2-9][0-9])\./.test(runtime.stdout))throw new InstallError('DEPENDENCIES');
   const data=await dbInfo(dataHome);let oldInfo;try{oldInfo=old?verifyFiles(old):null;}catch{}
   const fs=statfsSync(installHome);let writable=true;const test=join(stateHome,'write-'+process.pid);try{writeFileSync(test,'',{flag:'wx',mode:0o600});rmSync(test);}catch{writable=false;}
   const dependencies=[];
   if(process.platform==='linux')for(const binary of ['runtime/node',...(delivery?.browser==='system-chrome'?[]:['browsers/chromium-1248/chrome-linux64/chrome','browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell'])]){
    const r=spawnSync('/usr/bin/ldd',[join(source,binary)],{env:{...process.env,LC_ALL:'C',LD_LIBRARY_PATH:join(source,'lib')},encoding:'utf8'});
    if(r.error||r.status!==0||/not found/.test(r.stdout))throw new InstallError('DEPENDENCIES');
    dependencies.push({component:binary,status:'isolated-ready'});
   }
   if(delivery?.browser==='system-chrome'){
    const chrome=process.platform==='linux'?'/opt/google/chrome/chrome':[process.env.LOCALAPPDATA,process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)']].filter(Boolean).map(p=>join(p,'Google/Chrome/Application/chrome.exe')).find(existsSync);
    if(!chrome||!existsSync(chrome))throw new InstallError('DEPENDENCIES');
    const version=spawnSync(chrome,['--version'],{encoding:'utf8',timeout:5000,windowsHide:true});
    dependencies.push({component:'system Chrome',status:version.status===0?'available; protected probe required':'protected probe required'});
   }
   const version=old?readJSON(join(old,'package.json'))?.version:null;
   return {supported,platform:process.platform,architecture:process.arch,distribution:os.ID??'windows',osVersion:os.VERSION_ID??release(),integrity:true,dataIntegrity:data.integrity,dataPresent:data.exists,schema:data.schema??null,writable,freeBytes:Number(fs.bavail)*Number(fs.bsize),requiredBytes:info.bytes*2+134217728,currentSame:oldInfo?.id===info.id,installedVersion:version,dependencies,needsNetwork:false,online:null,requiresAdmin:false,browser:delivery?.browser??'isolated-chromium'};
  },
  recover,
  async prepare(){
   old=current();if(old){verifyFiles(old);await stop(old,dataHome);}
   const database=await dbInfo(dataHome);if(!database.integrity)throw new InstallError('DATA_INTEGRITY');
   if(database.exists){const {DatabaseSync,backup}=await import('node:sqlite');const backups=join(dataHome,'backups');privateDirectory(backups);const db=new DatabaseSync(join(dataHome,'data/yaplix.sqlite'),{readOnly:true});try{await backup(db,join(backups,'before-install-'+Date.now()+'.sqlite'));}finally{db.close();}}
   const snapshot={rollback:true,previous:old?old.split(/[\\/]/).pop():null,candidate:info.id};atomicJSON(transaction,snapshot);return snapshot;
  },
  async install(){
   if(existsSync(candidate)){verifyFiles(candidate);return;}
   privateDirectory(dirname(candidate));const stage=mkdtempSync(join(dirname(candidate),'.pending-'));
   try{cpSync(source,stage,{recursive:true,dereference:false});verifyFiles(stage);renameSync(stage,candidate);}finally{if(existsSync(stage))rmSync(stage,{recursive:true});}
  },
  async verify(){
   verifyFiles(candidate);probeHome=mkdtempSync(join(stateHome,'probe-'));atomicJSON(join(probeHome,'installer-owner.json'),{id:info.id});command(candidate,[],probeHome);
   try{
    const state=readJSON(join(probeHome,'desktop.json'));if(!state)throw new InstallError('VERIFY');
    const base='http://127.0.0.1:'+state.port;
    const apiReady=(await fetch(base+'/healthz',{headers:{Connection:'close'},signal:AbortSignal.timeout(5000)})).ok;
    const ui=await fetch(base+'/',{headers:{Connection:'close'},signal:AbortSignal.timeout(5000)});const uiReady=ui.ok&&(await ui.text()).includes('YAPLIX');
    // Real protected Chromium, independent of process exit codes and UI smoke.
    const r=spawnSync(join(candidate,'runtime',process.platform==='win32'?'node.exe':'node'),[join(candidate,'scripts/install-probe.mjs')],{env:processEnv(candidate,probeHome),encoding:'utf8',timeout:20000,windowsHide:true});
    if(r.error||r.status!==0)throw new InstallError(delivery?.browser==='system-chrome'?'LITE_BROWSER':'SANDBOX');
    return {apiReady,uiReady,sandboxReady:JSON.parse(r.stdout).sandboxReady===true};
   }finally{if(probeHome){await stop(candidate,probeHome);rmSync(probeHome,{recursive:true,force:true});probeHome=null;}}
  },
  async abort(){if(probeHome){await stop(candidate,probeHome);rmSync(probeHome,{recursive:true,force:true});probeHome=null;}},
  async launch(){command(candidate,[],dataHome);started=true;const state=readJSON(join(dataHome,'desktop.json'));if(!state)throw new InstallError('START');return {url:'http://127.0.0.1:'+state.port+'/'};},
  async commit(){await shortcuts(candidate);atomicJSON(pointer,{id:info.id});rmSync(transaction,{force:true});},
  async rollback(snapshot){
   if(started)await stop(candidate,dataHome);
   if(snapshot.previous){const previous=join(installHome,'versions',snapshot.previous);verifyFiles(previous);await shortcuts(previous);atomicJSON(pointer,{id:snapshot.previous});}
   rmSync(transaction,{force:true});
  }
 };
}
