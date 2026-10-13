import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {configuredGenerator,GenerationFailure} from '../src/live.ts';
import {Store} from '../src/store.ts';
import {Fault} from '../src/contracts.ts';
import type {GameSpec} from '../src/contracts.ts';
const adapter=configuredGenerator();if(!adapter)throw new Fault('LLM_NOT_CONFIGURED');
const directory='.local/live/'+randomUUID();mkdirSync(directory,{recursive:true});const store=new Store(directory+'/data.sqlite');
const prompts=[
 'Космический рейс: корабль внизу двигается стрелками и пальцем, уклоняется от падающих красных астероидов. Выжить 15 секунд — победа, столкновение — поражение. Старт, пауза/продолжение, заново. Счёт и время, тёмное звёздное небо.',
 'Арканоид: управляемая стрелками и пальцем платформа отбивает шар. Разбей 6 кирпичей для победы. Потеря шара — поражение. Старт, пауза/продолжение, заново. Видимый счёт, аккуратный мобильный Canvas.',
 'Лабиринт 6x6: игрок идёт к зелёному выходу стрелками или четырьмя touch-кнопками. Стены блокируют движение, красные клетки дают поражение. Выход — победа. Маршрут до выхода существует. Старт, пауза/продолжение, заново.'
];
const results:object[]=[];
try{
 for(const prompt of prompts){
  const spec:GameSpec={prompt,audience:'default',genre:'unknown',mechanics:[],controls:['keyboard','touch','pointer'],responsive:true,webview:true};
  try{const artifact=await adapter.generate(spec,undefined,'llm_code');const version=store.save(spec,artifact);if(createHash('sha256').update(version.html).digest('hex')!==version.sha256)throw new Fault('EXPORT_HASH_MISMATCH');writeFileSync(directory+'/'+version.versionId+'.html',version.html);const {html,...metadata}=version;results.push({status:'browser_preflight_pass',htmlBytes:Buffer.byteLength(html),metadata,fullGameplay:'not_verified'});console.log(JSON.stringify({versionId:version.versionId,model:version.model,attempts:version.generation?.attempts.length,status:'browser_preflight_pass'}));}
  catch(error){results.push({status:'failed',error:error instanceof Fault?error.code:'GENERATION_FAILED',attempts:error instanceof GenerationFailure?error.attempts:[],prompt});console.log(JSON.stringify({status:'failed',error:error instanceof Fault?error.code:'GENERATION_FAILED'}));process.exitCode=1;}
 }
}finally{adapter.close();store.close();writeFileSync(directory+'/evidence.json',JSON.stringify({results,comparison:'Free router selects models dynamically; this is a small task set, not evidence of a best model.'},null,2));console.log(JSON.stringify({directory,successes:results.filter((r:any)=>r.status==='browser_preflight_pass').length,requests:prompts.length}));}
