// Isolated offline browser fixture: never loads .env or the user's database.
import { serve } from '@hono/node-server';
import { Store } from '../src/store.ts';
import { createApp } from '../src/api.ts';
import { ArenaConnection } from '../src/arena.ts';
import { GenerationJobs } from '../src/jobs.ts';
import { lanAddresses } from '../src/network.ts';
if (!process.env.YAPLIX_ARENA_TEST_DB) throw new Error('TEST_DB_REQUIRED');
const store=new Store(process.env.YAPLIX_ARENA_TEST_DB);
const address=lanAddresses()[0]?.address;
if(!address)throw new Error('TEST_PRIVATE_IPV4_REQUIRED');
const arena=new ArenaConnection(store,async()=>[{name:'Isolated browser fixture',address}],0);
const jobs=new GenerationJobs(store,undefined,undefined,false);
const server=serve({fetch:createApp(store,undefined,undefined,undefined,undefined,undefined,jobs,undefined,undefined,arena).fetch,hostname:'127.0.0.1',port:0},()=>{
  process.send?.({origin:'http://127.0.0.1:'+(server.address() as {port:number}).port});
});
let stopping=false;
async function stop(){if(stopping)return;stopping=true;await arena.shutdown();await jobs.close();if('closeAllConnections' in server)server.closeAllConnections();server.close(()=>{store.close();process.disconnect?.();});}
process.on('message',message=>{if(message==='shutdown')void stop();});
process.on('SIGTERM',()=>void stop());process.on('disconnect',()=>void stop());
