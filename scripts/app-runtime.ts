import { fork, spawn } from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { checkPort } from '../src/network.ts';
import { Fault } from '../src/contracts.ts';
import { PROJECT_ROOT } from '../src/store.ts';
import { proof, runtimeKey, RUNTIME_PROTOCOL } from '../src/runtime-control.ts';
import { boundedText } from '../src/transport.ts';
import {buildIdentity} from '../src/build-identity.ts';

export async function appIdentity(port:number,key:string){
  const base='http://127.0.0.1:'+port,nonce=randomBytes(32).toString('hex');
  const read=async(path:string)=>{const response=await fetch(base+path,{redirect:'error',signal:AbortSignal.timeout(1500)});if(!response.ok)throw new Fault('BACKEND_NOT_READY');return JSON.parse(await boundedText(response,4096));};
  const identity=await read('/api/runtime/tunnel?nonce='+nonce);
  if(identity.app!=='YAPLIX'||identity.protocol!==RUNTIME_PROTOCOL||identity.proof!==proof(key,nonce,identity.instance)||identity.mode!=='local'||identity.schemaVersion!==3)throw new Fault('BACKEND_NOT_READY');
  if(identity.buildId!==buildIdentity())throw new Fault('BACKEND_UPDATE_RESTART_REQUIRED');
  const health=await read('/healthz');if(health.ready!==true||health.instance!==identity.instance)throw new Fault('BACKEND_NOT_READY');return identity.instance as string;
}

export async function runApp(options:{port:number;env?:NodeJS.ProcessEnv;signal:AbortSignal;open?:boolean;openBrowser?:(url:string)=>void;announce?:(text:string)=>void;startBackend?:(env:NodeJS.ProcessEnv)=>ChildProcess;portRange?:{from:number;to:number};explicitPort?:boolean;announcePortSwitch?:(from:number,to:number)=>void}){
  if(!Number.isSafeInteger(options.port)||options.port<1||options.port>65535)throw new Fault('INVALID_PORT');
  // STARTUP-002: явный PORT уважается строго; без него — автоподбор свободного порта.
  // Диапазон по умолчанию 3000–3010; чужие процессы не трогаем, свой же клон останавливаем штатно.
  const range=options.portRange??{from:3000,to:3010};
  const candidates=options.explicitPort?[options.port]:Array.from({length:range.to-range.from+1},(_,i)=>range.from+i).filter(p=>p>=1&&p<=65535);
  if(!candidates.includes(options.port))candidates.unshift(options.port);
  let portConflictError:unknown=null;
  for(const candidate of candidates){
    try{return await runAppOnPort({...options,port:candidate,announcePortSwitch:(from,to)=>{try{const a=options.announce??console.log;a('Порт '+from+' занят, пробую следующий...');}catch{}}});}
    catch(error){
      // Чужой занятый порт при неявном PORT — пробуем следующий, не трогая чужой процесс.
      // Fault хранит весь текст в code, поэтому сравниваем по префиксу кода.
      const code=error instanceof Fault?error.code:'';
      // Дальше идёт только чужой занятый порт (TRY_NEXT). Свой неостановленный backend
      // и явные PORT_IN_USE пробрасываются как фатальные: свой клон не бросаем висеть.
      const tryNext=code.indexOf('PORT_OCCUPIED_TRY_NEXT')===0;
      if(tryNext&&!options.explicitPort&&candidate!==candidates[candidates.length-1]){portConflictError=error;continue;}
      throw error;
    }
  }
  if(portConflictError)throw new Fault('PORT_IN_USE: все порты '+candidates[0]+'–'+candidates[candidates.length-1]+' заняты. Освободите один из них или укажите свободный явно: PORT=3001 ./yaplix.sh');
  throw new Fault('PORT_IN_USE');
}
async function runAppOnPort(options:{port:number;env?:NodeJS.ProcessEnv;signal:AbortSignal;open?:boolean;openBrowser?:(url:string)=>void;announce?:(text:string)=>void;startBackend?:(env:NodeJS.ProcessEnv)=>ChildProcess;explicitPort?:boolean;announcePortSwitch?:(from:number,to:number)=>void}){
  if(!Number.isSafeInteger(options.port)||options.port<1||options.port>65535)throw new Fault('INVALID_PORT');
  const key=runtimeKey(),url='http://127.0.0.1:'+options.port+'/',announce=options.announce??console.log;
  let free=true;
  try{await checkPort({mode:'local',host:'127.0.0.1',port:options.port});}catch(error){if(!(error instanceof Fault)||error.code!=='PORT_IN_USE')throw error;free=false;}
  if(!free){
    // Occupied port: decide only from the authenticated identity proof. No signal
    // or PID-based action is taken against any process that fails this check.
    let sameClone=false;
    try{await appIdentity(options.port,key);sameClone=true;}catch(error){if(error instanceof Fault&&error.code==='BACKEND_UPDATE_RESTART_REQUIRED')sameClone=true;}
    if(!sameClone){
      if(options.explicitPort)throw new Fault('PORT_IN_USE: порт '+options.port+' занят. Он сохранён; укажите свободный явно: PORT=3001 ./yaplix.sh');
      options.announcePortSwitch?.(options.port,options.port+1);
      throw new Fault('PORT_OCCUPIED_TRY_NEXT: порт '+options.port+' занят чужим процессом; он сохранён, пробую следующий.');
    }
    // Authenticated graceful shutdown of ONLY the proven same-clone backend:
    // HMAC-nonce endpoint is loopback-only, so LAN/tunnel/public callers cannot
    // reach it and the request is refused without the local key.
    let stopped=false;
    try{const nonce=randomBytes(32).toString('hex');
      const identity=await(await fetch('http://127.0.0.1:'+options.port+'/api/runtime/tunnel?nonce='+nonce,{redirect:'error',signal:AbortSignal.timeout(1500)})).json();
      if(identity.proof===proof(key,nonce,identity.instance)&&identity.buildId===buildIdentity())
        stopped=await stopOwnedBackend(options.port,key,identity.instance);
    }catch{/* fall through: port check below decides */}
    if(!stopped)throw new Fault('PORT_IN_USE: свой backend не подтвердил штатное завершение; порт сохранён. Повторите запуск или выберите PORT.');
    for(let i=0;i<50;i++){try{await checkPort({mode:'local',host:'127.0.0.1',port:options.port});break;}catch{await delay(200);}}
  }
  const env={...options.env,PORT:String(options.port),YAPLIX_MODE:'local',YAPLIX_HOST:'127.0.0.1',PUBLIC_URL:'',YAPLIX_ACCESS_KEY:''};
  const child=options.startBackend?.(env)??fork('src/server.ts',[],{cwd:PROJECT_ROOT,env,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
  let error='',portConflict=false;child.stderr?.on('data',chunk=>{const text=String(chunk);if(/\b(?:PORT_IN_USE|EADDRINUSE)\b/.test(text))portConflict=true;else error='BACKEND_START_FAILED: проверьте диагностику и настройки .env';});child.stdout?.on('data',()=>{});child.on('error',()=>{error='BACKEND_START_FAILED';});
  const closed=new Promise<void>(done=>child.once('close',()=>done()));let cancelled!:()=>void;const aborted=new Promise<void>(done=>cancelled=done);const stop=()=>{if(child.connected)child.send('shutdown',()=>{});cancelled();};options.signal.addEventListener('abort',stop,{once:true});
  try{
    let ready=false;for(let i=0;i<100&&!options.signal.aborted&&!portConflict;i++){if(child.exitCode!==null)break;try{await appIdentity(options.port,key);ready=true;break;}catch{}await delay(200);}
    if(!ready){
      if(options.signal.aborted)return{attached:false};
      // Гонка: порт освободился при проверке, но занят к моменту listen. При неявном PORT — следующий порт.
      if(portConflict&&!options.explicitPort)throw new Fault('PORT_OCCUPIED_TRY_NEXT: порт '+options.port+' занят при запуске сервера (EADDRINUSE); пробую следующий.');
      throw new Fault(portConflict?'PORT_IN_USE: порт '+options.port+' занят при запуске сервера. Он сохранён; укажите свободный явно: PORT=3001 ./yaplix.sh':error||'BACKEND_NOT_READY');
    }
    if(options.port!==Number(process.env.PORT??3000))announce('Выбран свободный порт '+options.port+'.');
    announce('YAPLIX готов: '+url+' · Остановка: Ctrl+C в этом окне.');if(options.open!==false)open(url,options.openBrowser);if(options.signal.aborted)stop();await Promise.race([closed,aborted]);return{attached:false};
  }finally{options.signal.removeEventListener('abort',stop);if(child.exitCode===null&&child.signalCode===null){stop();let timer:ReturnType<typeof setTimeout>|undefined;const timeout=new Promise<boolean>(done=>{timer=setTimeout(()=>done(true),7000);});if(await Promise.race([closed.then(()=>false),timeout])){child.kill('SIGKILL');clearTimeout(timer);const forced=new Promise<boolean>(done=>{timer=setTimeout(()=>done(true),2000);});if(await Promise.race([closed.then(()=>false),forced]))throw new Fault('OWN_CHILD_CLOSE_TIMEOUT');}clearTimeout(timer);}
}
}
function open(url:string,override?: (url:string)=>void){
  if(override){override(url);return;}
  const cmd = process.platform==='win32' ? 'rundll32.exe url.dll,FileProtocolHandler '+url : 'xdg-open '+url;
  const child = spawn(cmd, { shell: true, stdio: 'ignore', windowsHide: true });
  child.on('error',()=>console.log('Откройте в браузере: '+url));
  child.unref();
}
/**
 * Graceful shutdown of the proven same-clone backend via the authenticated
 * loopback endpoint. The backend itself closes jobs/Telegram/SQLite before
 * releasing the port. Never signals any other process; if the endpoint is
 * unreachable the backend stays running and the launcher reports PORT_IN_USE.
 */
export async function stopOwnedBackend(port:number,key:string,instance:string):Promise<boolean>{
  try{
    const response=await fetch('http://127.0.0.1:'+port+'/api/runtime/shutdown',{method:'POST',headers:{'X-Yaplix-Control':key,'X-Yaplix-Instance':instance},signal:AbortSignal.timeout(5000)});
    if(!response.ok)return false;await response.body?.cancel();
  }catch{return false;}
  for(let i=0;i<20;i++){try{await checkPort({mode:'local',host:'127.0.0.1',port});return true;}catch{await delay(200);}}
  return false;
}
