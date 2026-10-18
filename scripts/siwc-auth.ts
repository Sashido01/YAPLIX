import {spawn} from 'node:child_process';
import {LocalSiwc,SiwcError} from '../src/experimental/siwc.ts';

// Explicit owner-operated browser sign-in only. Never load .env or call inference.
const command=process.argv.slice(2);
if(command.length!==1||!['--prepare','--authorize'].includes(command[0])){
 console.error('Usage: node scripts/siwc-auth.ts --prepare | --authorize');process.exitCode=2;
}else{
 const auth=new LocalSiwc({openBrowser:async url=>{
  await new Promise<void>((yes,no)=>{
   const child=spawn(process.platform==='win32'?'rundll32.exe':'xdg-open',process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url],{stdio:'ignore',windowsHide:true});
   child.once('error',()=>no(new SiwcError('SIWC_BROWSER_UNAVAILABLE')));child.once('exit',code=>code===0?yes():no(new SiwcError('SIWC_BROWSER_UNAVAILABLE')));
  });
 }});
 const cancelled=new AbortController();const stop=()=>cancelled.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  const prepared=auth.prepare();
  if(command[0]==='--prepare')console.log(JSON.stringify({hostPrepared:true,registered:prepared.registered,authorization:'NOT_RUN',inference:'NOT_RUN'}));
  else{const status=await auth.signIn(cancelled.signal);auth.dispose();console.log(JSON.stringify({authorization:'VERIFIED',planPermissionGranted:status.planPermissionGranted,tokensPersisted:false,inference:'NOT_RUN'}));}
 }catch(error){console.error(error instanceof SiwcError?error.message:'SIWC_UNAVAILABLE');process.exitCode=1;}
 finally{auth.dispose();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
