import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {LocalSiwc,SiwcError} from '../src/experimental/siwc.ts';

// Explicit owner-operated CLI. Never load .env; --probe permits one inference.
type CliOptions={authOptions?:Partial<ConstructorParameters<typeof LocalSiwc>[0]>;
 stdout?:(value:string)=>void;stderr?:(value:string)=>void;probeTimeoutMs?:number};
async function openSystemBrowser(url:string){
  await new Promise<void>((yes,no)=>{
   const child=spawn(process.platform==='win32'?'rundll32.exe':'xdg-open',process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url],{stdio:'ignore',windowsHide:true});
   child.once('error',()=>no(new SiwcError('SIWC_BROWSER_UNAVAILABLE')));child.once('exit',code=>code===0?yes():no(new SiwcError('SIWC_BROWSER_UNAVAILABLE')));
  });
}
// The executable entry point and offline tests call this same function. Only
// tests inject the HTTP/browser boundary; no CLI/env route overrides exist.
export async function runSiwcCli(command:string[],options:CliOptions={}):Promise<number>{
 const out=options.stdout??console.log,err=options.stderr??console.error;
 if(command.length!==1||!['--prepare','--authorize','--probe'].includes(command[0])){
  err('Usage: node scripts/siwc-auth.ts --prepare | --authorize | --probe');return 2;
 }
 const auth=new LocalSiwc({...options.authOptions,openBrowser:options.authOptions?.openBrowser??openSystemBrowser});
 const cancelled=new AbortController();const stop=()=>cancelled.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  const prepared=auth.prepare();
  if(command[0]==='--prepare')out(JSON.stringify({hostPrepared:true,registered:prepared.registered,authorization:'NOT_RUN',inference:'NOT_RUN'}));
  else{
   if(command[0]==='--probe')err('Owner probe: official OAuth, fresh catalog must list gpt-6.1-sol, reasoning medium, at most ONE inference POST. No Pro, substitution or retries.');
   const status=await auth.signIn(cancelled.signal);
   if(command[0]==='--probe'){
    const report=await auth.probe({signal:cancelled.signal,timeoutMs:options.probeTimeoutMs});auth.dispose();out(JSON.stringify(report));
    if(report.result!=='PASS')return 1;
   }else{auth.dispose();out(JSON.stringify({authorization:'VERIFIED',planPermissionGranted:status.planPermissionGranted,tokensPersisted:false,inference:'NOT_RUN'}));}
  }
  return 0;
 }catch(error){err(error instanceof SiwcError?error.message:'SIWC_UNAVAILABLE');return 1;}
 finally{auth.dispose();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=await runSiwcCli(process.argv.slice(2));
