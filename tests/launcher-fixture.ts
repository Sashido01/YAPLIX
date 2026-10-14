// Independently authored synthetic child: confirms same-clone identity but
// deliberately ignores shutdown. Used only to prove bounded owned cleanup.
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {runtimeKey,proof,RUNTIME_PROTOCOL} from '../src/runtime-control.ts';
const key=runtimeKey(),instance=randomUUID();
createServer((request,response)=>{
  const url=new URL(request.url!,'http://127.0.0.1');response.setHeader('Content-Type','application/json');
  response.end(JSON.stringify(url.pathname==='/healthz'?{app:'YAPLIX',instance,ready:true}:{app:'YAPLIX',instance,mode:'local',protocol:RUNTIME_PROTOCOL,schemaVersion:2,proof:proof(key,url.searchParams.get('nonce')!,instance)}));
}).listen(Number(process.env.PORT),'127.0.0.1');
process.on('message',()=>{});process.on('SIGTERM',()=>{});
