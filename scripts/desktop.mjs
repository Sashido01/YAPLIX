// Installed launcher: no npm, build, downloads, .env loading or inferred LAN mode.
import {existsSync,mkdirSync,readFileSync,writeFileSync,unlinkSync,statSync,lstatSync,chmodSync,renameSync} from 'node:fs';
import {resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {fork,spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);process.umask(0o077);
const home=process.env.YAPLIX_DATA_HOME??(process.platform==='win32'?resolve(process.env.LOCALAPPDATA??homedir(),'YAPLIX'):resolve(process.env.XDG_DATA_HOME??resolve(homedir(),'.local/share'),'yaplix'));
const stateFile=resolve(home,'desktop.json'),lockFile=resolve(home,'desktop.lock'),log=resolve(home,'desktop.log');
let initialized=false;
function initialize(){
if(!isAbsolute(home))throw Error('DATA_PATH');
process.env.YAPLIX_DATA_HOME=home;
// Refuse links before any mutable file is opened. The data directory is private.
for(let part=home;;part=dirname(part)){
 try{if(lstatSync(part).isSymbolicLink())throw Error('DATA_LINK');}catch(e){if(e.code!=='ENOENT')throw e;}
 if(dirname(part)===part)break;
}
mkdirSync(home,{recursive:true,mode:0o700});
if(process.platform!=='win32')chmodSync(home,0o700);
for(const name of ['desktop.json','desktop.lock','desktop.log','providers.json']){
 try{const info=lstatSync(resolve(home,name));if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw Error('DATA_LINK');}catch(e){if(e.code!=='ENOENT')throw e;}
}
initialized=true;
}
const readState=()=>{try{return JSON.parse(readFileSync(stateFile,'utf8'));}catch{return null;}};
const journal=code=>{if(!initialized)return;try{if(existsSync(log)&&statSync(log).size>65536)writeFileSync(log,'');writeFileSync(log,new Date().toISOString()+' '+code+'\n',{flag:'a',mode:0o600});}catch{}};
const openTarget=target=>{
 const child=process.platform==='win32'?spawn('rundll32.exe',['url.dll,FileProtocolHandler',target],{stdio:'ignore',windowsHide:true}):spawn('xdg-open',[target],{stdio:'ignore'});
 child.on('error',()=>journal('BROWSER_OPEN_FAILED'));child.unref();
};
const tell=message=>{
 console.error(message);
 if(process.argv.includes('--no-open'))return;
 if(process.platform==='win32')spawnSync('powershell.exe',['-NoProfile','-File',resolve(root,'packaging/dialog.ps1'),'-Message',message],{windowsHide:true,stdio:'ignore'});
 else spawnSync('zenity',['--error','--title=YAPLIX','--text='+message],{stdio:'ignore'});
};
function verify(){
 const [major,minor]=process.versions.node.split('.').map(Number);
 if(major!==24||minor<18||process.arch!=='x64'||!['linux','win32'].includes(process.platform))throw Error('RUNTIME');
 const manifest=resolve(root,'integrity.json');
 if(!existsSync(manifest)){if(existsSync(resolve(root,'runtime')))throw Error('INTEGRITY');return;}
 for(const [path,hash] of Object.entries(JSON.parse(readFileSync(manifest,'utf8')))){
  const file=resolve(root,path);if(!file.startsWith(root)||createHash('sha256').update(readFileSync(file)).digest('hex')!==hash)throw Error('INTEGRITY');
 }
}
async function identity(state){
 if(!state||!Number.isInteger(state.port)||state.port<1||state.port>65535)return null;
 const {appIdentity}=await import('./app-runtime.ts');const {runtimeKey}=await import('../src/runtime-control.ts');
 try{const instance=await appIdentity(state.port,runtimeKey());return instance===state.instance?instance:null;}catch{return null;}
}
async function serve(){
 verify();
 let owned=false;
 for(let i=0;i<100;i++){
  try{writeFileSync(lockFile,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});owned=true;break;}
  catch(e){if(e.code!=='EEXIST')throw e;
   const state=readState();if(await identity(state)){process.send?.({ready:true,port:state.port});return;}
   try{const {pid}=JSON.parse(readFileSync(lockFile,'utf8'));if(!Number.isInteger(pid)||pid<1)throw Error('LOCK_INVALID');
    try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH'){unlinkSync(lockFile);continue;}throw error;}
   }catch(error){if(error.code==='ENOENT')continue;}
   await delay(200);
  }
 }
 if(!owned)throw Error('BUSY');
 const controller=new AbortController();process.on('SIGTERM',()=>controller.abort());process.on('SIGINT',()=>controller.abort());
 try{
  const {runApp}=await import('./app-runtime.ts');const {checkPort}=await import('../src/network.ts');
  const firstPort=createHash('sha256').update(home).digest().readUInt32BE(0)%20;
  // Explicit local config only; credentials never enter arguments, state or logs.
  const settingsPath=resolve(home,'providers.json');
  const settings=existsSync(settingsPath)?JSON.parse(readFileSync(settingsPath,'utf8')):{};
  const env={...process.env,LIVE_PROVIDER:'ollama-cloud',YAPLIX_DB:'.local/data/yaplix.sqlite',TELEGRAM_UPDATES:'off',TELEGRAM_BOT_TOKEN:'',LLM_AUTO_REPAIR:'0'};
  for(const key of ['OLLAMA_API_KEY','OLLAMA_CLOUD_API_KEY','CLOUD_API_KEY']){delete env[key];if(typeof settings[key]==='string')env[key]=settings[key];}
  if(existsSync(resolve(root,'browsers')))env.PLAYWRIGHT_BROWSERS_PATH=resolve(root,'browsers');
  const delivery=resolve(root,'packaging/delivery.json');
  if(existsSync(delivery)){env.YAPLIX_BROWSER_CHANNEL=JSON.parse(readFileSync(delivery,'utf8')).browser==='system-chrome'?'chrome':'chromium';}
  if(existsSync(resolve(root,'lib')))env.LD_LIBRARY_PATH=resolve(root,'lib');
  const helper=resolve(root,'browsers/chromium-1248/chrome-linux64/chrome_sandbox');
  if(process.platform==='linux'&&existsSync(helper)){const s=statSync(helper);if(s.uid===0&&(s.mode&0o4000)&&!(s.mode&0o022))env.CHROME_DEVEL_SANDBOX=helper;else delete env.CHROME_DEVEL_SANDBOX;}
  let lastConflict=false;
  for(let offset=0;offset<20;offset++){
   const port=3000+(firstPort+offset)%20;
   try{
    await checkPort({mode:'local',host:'127.0.0.1',port});
    await runApp({port,env,signal:controller.signal,open:false,announce:async()=>{
     const {appIdentity}=await import('./app-runtime.ts');const {runtimeKey}=await import('../src/runtime-control.ts');
     const instance=await appIdentity(port,runtimeKey());writeFileSync(stateFile,JSON.stringify({port,instance}),{mode:0o600});journal('READY');process.send?.({ready:true,port});process.disconnect?.();
    }});
    return;
   }catch(error){if(!String(error?.code??'').startsWith('PORT_IN_USE'))throw error;lastConflict=true;}
  }
  if(lastConflict)throw Object.assign(Error('PORT_IN_USE'),{code:'PORT_IN_USE'});
 }finally{unlinkSync(lockFile);try{unlinkSync(stateFile);}catch{}journal('STOPPED');}
}
async function main(){
 initialize();
if(process.argv.includes('--serve')){try{await serve();}catch(error){journal('START_FAILED');process.send?.({error:true,code:error?.code??'START'});process.disconnect?.();process.exitCode=1;}return;}
 if(process.argv.includes('--logs')){openTarget(log);return;}
 if(process.argv.includes('--settings')){
  if(await identity(readState())){tell('Сначала откройте «Остановить YAPLIX», затем настройте AI.');return;}
  let provider,key;
  if(process.platform==='win32'){
   const r=spawnSync('powershell.exe',['-NoProfile','-File',resolve(root,'packaging/dialog.ps1'),'-Settings'],{encoding:'utf8',windowsHide:true});if(r.status!==0)return;const parsed=JSON.parse(r.stdout);provider=parsed.provider;key=parsed.key;
  }else{
   const r=spawnSync('zenity',['--list','--radiolist','--title=Настройка AI YAPLIX','--text=Выберите провайдера. Для обычного запуска AI не нужен.','--column=','--column=Провайдер','TRUE','Ollama Cloud','FALSE','OpenRouter Free'],{encoding:'utf8'});if(r.status!==0)return;provider=r.stdout.trim();
   const secret=spawnSync('zenity',['--password','--title=Ключ AI YAPLIX','--text=Введите API-ключ. Он хранится локально в файле с доступом только вашему пользователю. Пустое поле удаляет ключ.'],{encoding:'utf8'});if(secret.status!==0)return;key=secret.stdout.trim();
  }
  if(!['Ollama Cloud','OpenRouter Free'].includes(provider)||typeof key!=='string'||key.length>4096||/[\r\n\0]/.test(key))throw Error('SETTINGS');
  const path=resolve(home,'providers.json'),settings=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{};
  const field=provider==='Ollama Cloud'?'OLLAMA_CLOUD_API_KEY':'CLOUD_API_KEY';settings[field]=key;const temporary=path+'.'+process.pid+'.tmp';writeFileSync(temporary,JSON.stringify(settings),{mode:0o600,flag:'wx'});renameSync(temporary,path);journal('SETTINGS_SAVED');return;
 }
 const state=readState(),instance=await identity(state);
 if(process.argv.includes('--status')){console.log(instance?'running':'stopped');return;}
 if(process.argv.includes('--stop')){
  if(instance){const {stopOwnedBackend}=await import('./app-runtime.ts');const {runtimeKey}=await import('../src/runtime-control.ts');if(!await stopOwnedBackend(state.port,runtimeKey(),instance))throw Error('STOP');}
  return;
 }
 if(instance){if(!process.argv.includes('--no-open'))openTarget('http://127.0.0.1:'+state.port+'/');console.log('running '+state.port);return;}
 verify();
 const child=fork(fileURLToPath(import.meta.url),['--serve'],{cwd:root,env:process.env,detached:true,stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
 const ready=await new Promise((done,fail)=>{const timer=setTimeout(()=>fail(Error('TIMEOUT')),30000);child.once('message',msg=>{clearTimeout(timer);if(msg.ready)done(msg);else fail(Object.assign(Error('START'),{code:msg.code??'START'}));});child.once('error',fail);child.once('exit',code=>{if(code)fail(Error('START'));});});
 if(child.connected)child.disconnect();child.unref();if(!process.argv.includes('--no-open'))openTarget('http://127.0.0.1:'+ready.port+'/');console.log('running '+ready.port);
}
try{await main();}catch(error){journal('LAUNCH_FAILED');tell(error.code==='EACCES'?'Не удалось получить доступ к файлам YAPLIX.':error.code==='ENOSPC'?'Недостаточно свободного места.':'Не удалось запустить YAPLIX. Откройте «Журнал YAPLIX». Проверьте целостность установки и доступность портов 3000–3019.');process.exitCode=1;}
