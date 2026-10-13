import {spawn,fork} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {managedPath,PROJECT_ROOT} from '../src/store.ts';
import {persistentLanKey,checkPort} from '../src/network.ts';
import {missingProductionFiles} from '../src/diagnostics.ts';
import {TelegramSessions} from '../src/telegram.ts';
import {Fault} from '../src/contracts.ts';
const version='2026.10.0';
const assets:Record<string,{name:string;sha:string}>={
 'win32-x64':{name:'cloudflared-windows-amd64.exe',sha:'86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c'},
 'linux-x64':{name:'cloudflared-linux-amd64',sha:'d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db'},
 'linux-arm64':{name:'cloudflared-linux-arm64',sha:'e6422b9d4f72d3194bc5a38676f13667c06666523217b842a877d72a80b5ac08'}
};
try {
 if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw new Fault('INSECURE_TLS_CONFIGURATION');
 const asset=assets[process.platform+'-'+process.arch];if(!asset)throw new Fault('TUNNEL_PLATFORM_UNSUPPORTED');
 const path=managedPath('.local/tools/'+asset.name);
 const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
 if(process.argv[2]==='install'){
  if(existsSync(path)){if(digest(readFileSync(path))!==asset.sha)throw new Fault('TUNNEL_EXISTING_FILE_MISMATCH');}
  else {
   let url=new URL('https://github.com/cloudflare/cloudflared/releases/download/'+version+'/'+asset.name),response:Response|undefined;
   for(let i=0;i<4;i++){
    response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(60000)});
    if(response.status>=300&&response.status<400){const next=new URL(response.headers.get('location')??'',url);await response.body?.cancel();if(next.protocol!=='https:'||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(next.hostname))throw new Fault('TUNNEL_DOWNLOAD_REDIRECT');url=next;continue;}break;
   }
   if(!response?.ok||!response.body)throw new Fault('TUNNEL_DOWNLOAD_FAILED');
   const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>100000000)throw new Fault('TUNNEL_DOWNLOAD_TOO_LARGE');parts.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
   const bytes=Buffer.concat(parts);if(digest(bytes)!==asset.sha)throw new Fault('TUNNEL_HASH_MISMATCH');writeFileSync(path,bytes,{flag:'wx',mode:0o700});
  }
  if(process.platform!=='win32')chmodSync(path,0o700);console.log('cloudflared '+version+' installed and SHA-256 verified inside .local/tools.');
 }else {
  if(!existsSync(path)||digest(readFileSync(path))!==asset.sha)throw new Fault('TUNNEL_INSTALL_REQUIRED');
  if(missingProductionFiles().length)throw new Fault('RUNTIME_BUILD_REQUIRED');
  if(!new TelegramSessions().configured())throw new Fault('TELEGRAM_NOT_CONFIGURED');
  const port=Number(process.env.PORT??3000);if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Fault('INVALID_PORT');
  await checkPort({mode:'local',host:'127.0.0.1',port});
  const key=persistentLanKey();
  if(process.argv.includes('--check')){console.log(JSON.stringify({ready:true,port,version,note:'No tunnel created.'}));}
  else {
   // The connector has no LLM/bot credentials and writes no global configuration.
   const ownHome=managedPath('.local/tunnel-home/config.yml').replace(/[\\/]config\.yml$/,'');
   const ownTemp=managedPath('.local/tmp/tunnel.tmp').replace(/[\\/]tunnel\.tmp$/,'');
   const env={...Object.fromEntries(['PATH','Path','SystemRoot'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]!])),HOME:ownHome,USERPROFILE:ownHome,LOCALAPPDATA:ownHome,TEMP:ownTemp,TMP:ownTemp};
   const connector=spawn(path,['tunnel','--no-autoupdate','--url','http://127.0.0.1:'+port],{cwd:PROJECT_ROOT,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
   let server:ReturnType<typeof fork>|undefined,menu:ReturnType<typeof fork>|undefined,stopped=false;
   const stop=()=>{if(stopped)return;stopped=true;connector.kill();menu?.kill();server?.send('shutdown');};
   process.on('SIGINT',stop);process.on('SIGTERM',stop);process.on('message',message=>{if(message==='shutdown')stop();});
   try{
    const origin=await new Promise<string>((done,fail)=>{const timer=setTimeout(()=>fail(new Fault('TUNNEL_START_TIMEOUT')),60000);let tail='';const read=(bytes:Buffer)=>{tail=(tail+bytes.toString()).slice(-5000);const match=tail.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/);if(match){clearTimeout(timer);done(match[0]);}};connector.stdout.on('data',read);connector.stderr.on('data',read);connector.once('error',()=>{clearTimeout(timer);fail(new Fault('TUNNEL_START_FAILED'));});connector.once('exit',()=>{clearTimeout(timer);fail(new Fault('TUNNEL_CLOSED'));});});
    writeFileSync(managedPath('.local/tunnel-url.txt'),origin+'/telegram\n');
    const serverEnv={...process.env,YAPLIX_MODE:'https',YAPLIX_HOST:'127.0.0.1',PUBLIC_URL:origin,YAPLIX_ACCESS_KEY:key};
    server=fork('src/server.ts',[],{cwd:PROJECT_ROOT,env:serverEnv,stdio:['ignore','pipe','pipe','ipc']});
    server.stdout!.on('data',bytes=>process.stdout.write(bytes));server.stderr!.on('data',()=>console.error('YAPLIX server reported an error; run npm run doctor locally for diagnosis.'));
    console.log('Temporary Mini App URL: '+origin+'/telegram\nSet this URL in @BotFather /setmenubutton. Ctrl+C closes the tunnel. Local .env PUBLIC_URL is unchanged.');
    if(process.argv.includes('--menu'))menu=fork('scripts/telegram-setup.ts',['menu'],{cwd:PROJECT_ROOT,env:serverEnv});
    connector.once('exit',stop);server.once('exit',stop);server.once('error',stop);
    await new Promise<void>(done=>server!.once('exit',()=>done()));
   }finally{stop();process.disconnect?.();}
  }
 }
}catch(error){console.error(error instanceof Fault?error.code:'TUNNEL_FAILED');process.exitCode=1;}
