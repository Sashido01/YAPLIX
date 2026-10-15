import {runTunnel,explain} from './tunnel-runtime.ts';
import {telegramMenu} from './telegram-menu.ts';
import {buildConnectorEnvFromParts,tunnelConnectorProxyForwarded} from './tunnel-connector-env.ts';
import {existsSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {managedPath,PROJECT_ROOT} from '../src/store.ts';
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
  const sessions=new TelegramSessions();
  if(!sessions.singleOwner())throw new Fault('TELEGRAM_SINGLE_OWNER_REQUIRED');
  const protocol=process.argv.includes('--protocol')?process.argv[process.argv.indexOf('--protocol')+1]:'auto';
  if(!['auto','http2','quic'].includes(protocol))throw new Fault('TUNNEL_PROTOCOL_INVALID');
  const ownHome=managedPath('.local/tunnel-home/config.yml').replace(/[\\/]config\.yml$/,'');
  const ownTemp=managedPath('.local/tmp/tunnel.tmp').replace(/[\\/]tunnel\.tmp$/,'');
  // TASK-014 root cause (docs/known-errors.md "TUNNEL_CLOSED proxy"): with
  // HTTP_PROXY and HTTPS_PROXY both inherited, cloudflared 2026.10.0 fails its
  // quick-tunnel provisioning POST (context deadline exceeded; reproduced
  // 2026-10-15 with the pinned binary through Xray), while no proxy and an
  // HTTPS-only proxy both work. The connector therefore runs with proxy
  // variables cleared: provisioning and edge transport stay direct, localhost
  // targets are never proxied either way, TLS stays verified and the connector
  // still receives no bot/LLM keys. Set YAPLIX_TUNNEL_CONNECTOR_PROXY=1 to
  // forward system proxy variables explicitly when a network requires it.
  const connectorEnv=buildConnectorEnvFromParts(process.env,ownHome,ownTemp,tunnelConnectorProxyForwarded(process.env));
  const stop=new AbortController(),shutdown=()=>stop.abort();
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);process.on('disconnect',shutdown);
  process.on('message',message=>{if(message==='shutdown')shutdown();});
  const menu=telegramMenu();
  try { await runTunnel({port,binary:path,connectorEnv,protocol:protocol as 'auto'|'http2'|'quic',signal:stop.signal,menu:process.argv.includes('--menu'),check:process.argv.includes('--check'),menuUpdate:menu.update,menuClear:menu.clear}); }
  finally {process.off('SIGINT',shutdown);process.off('SIGTERM',shutdown);process.off('disconnect',shutdown);process.disconnect?.();}

 }
}catch(error){console.error(explain(error));process.exitCode=1;}
