import {createServer} from 'node:http';
import {readFileSync,writeFileSync,existsSync,unlinkSync,lstatSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createAdapter} from './install-adapter.mjs';
import {runInstallation,planInstallation,failureCode,messages,InstallError} from './install-engine.mjs';
const source=fileURLToPath(new URL('../',import.meta.url));
process.umask(0o077);
const option=name=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined;};
const profile=option('--test-profile');
let adapter,lock,view,locked=false,server;
async function open(url){
 const p=process.platform==='win32'?spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{stdio:'ignore',windowsHide:true}):spawn('xdg-open',[url],{stdio:'ignore'});
 await new Promise((done,fail)=>{const timer=setTimeout(()=>{p.unref();done();},3000);p.once('error',()=>{clearTimeout(timer);fail(new InstallError('BROWSER'));});p.once('exit',code=>{clearTimeout(timer);code===0?done():fail(new InstallError('BROWSER'));});});
}
function acquire(){
 for(let i=0;i<2;i++)try{writeFileSync(lock,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});locked=true;return;}catch(e){
  if(e.code!=='EEXIST')throw e;if(lstatSync(lock).isSymbolicLink())throw new InstallError('PERMISSION');
  const state=JSON.parse(readFileSync(lock,'utf8'));if(!Number.isSafeInteger(state.pid)||state.pid<1)throw new InstallError('BUSY');
  try{process.kill(state.pid,0);throw new InstallError('BUSY');}catch(error){if(error.code!=='ESRCH')throw error;unlinkSync(lock);}
 }
 throw new InstallError('BUSY');
}
function cleanup(){if(locked){try{unlinkSync(lock);unlinkSync(view);}catch{}locked=false;}}
try{
 adapter=createAdapter({source,...(profile?{installHome:resolve(profile,'program'),dataHome:resolve(profile,'data'),menuHome:resolve(profile,'applications')}:{})});
 lock=join(adapter.stateHome,'install.lock');view=join(adapter.stateHome,'view.json');
 if(process.argv.includes('--diagnose')){const facts=await adapter.check();let plan,code;try{plan=planInstallation(facts);}catch(e){code=failureCode(e);}console.log(JSON.stringify({facts,plan,code},null,2));}
 else{
  acquire();process.once('exit',cleanup);const abort=async()=>{try{await adapter.abort?.();}finally{cleanup();process.exit(1);}};process.once('SIGTERM',abort);process.once('SIGINT',abort);
  if(process.argv.includes('--headless')){
   const result=await runInstallation(adapter,row=>adapter.log(row));console.log(JSON.stringify(result));cleanup();
  }else{
   const token=randomBytes(32).toString('hex');let state={stage:'CHECK'},running=false;
   server=createServer(async(req,res)=>{
    const host='127.0.0.1:'+server.address().port,origin='http://'+host;
    const send=(status,body,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer'});res.end(type==='application/json'?JSON.stringify(body):body);};
    if(req.headers.host!==host||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')return send(403,{});
    if(req.method==='GET'&&req.url==='/')return send(200,readFileSync(join(source,'packaging/install.html')),'text/html; charset=utf-8');
    if(req.method==='GET'&&req.url==='/install-client.js')return send(200,readFileSync(join(source,'packaging/install-client.js')),'text/javascript; charset=utf-8');
    if(req.headers['x-yaplix-installer']!==token)return send(403,{});
    if(req.method==='GET'&&req.url==='/api/status')return send(200,state);
    if(req.method==='POST'&&req.url==='/api/start'){
     if(running)return send(202,{});if(state.stage==='DONE')return send(200,{});running=true;
     send(202,{});
     try{
      const checked=adapter.check.bind(adapter);const withFacts={...adapter,check:async()=>{const f=await checked();state.facts={osVersion:f.osVersion,architecture:f.architecture};return f;}};
      const result=await runInstallation(withFacts,row=>{state={...state,...row};adapter.log(row);});state={...state,stage:'DONE',url:result.url};
      setTimeout(()=>{server.close();cleanup();},15000).unref();
     }catch(e){const code=failureCode(e);state={...state,stage:'ERROR',code,message:messages[code]};}
     finally{running=false;}
     return;
    }
    return send(404,{});
   });
   await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done);});const url='http://127.0.0.1:'+server.address().port+'/#'+token;writeFileSync(view,JSON.stringify({url}),{mode:0o600});
   if(!process.argv.includes('--no-open'))await open(url);
   setTimeout(()=>{if(!running){process.exitCode=state.stage==='DONE'?0:1;server.close();cleanup();}},30*60*1000).unref();
  }
 }
}catch(e){const code=failureCode(e);adapter?.log({stage:'ERROR',code});console.error(messages[code]);server?.close();cleanup();process.exitCode=1;}
