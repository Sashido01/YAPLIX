import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_ROOT } from './store.ts';
import { GenerationEngine } from './live.ts';
import type { Generator } from './transport.ts';
const files=['assets/index.html','assets/access.html','assets/demo.html','assets/style.css','build/public/ui.js','build/public/access-ui.js','build/public/connection-ui.js','build/public/telegram-ui.js'];
export function missingProductionFiles(){return files.filter(path=>!existsSync(resolve(PROJECT_ROOT,path)));}
export async function liveReadiness(adapter?:Generator){
  if(adapter instanceof GenerationEngine)return adapter.readiness();
  return{liveConfigured:Boolean(adapter),liveReady:false,llmState:adapter?'not_verified':'not_configured',provider:null,model:null,browserReady:false,fallbackConfigured:false};
}
