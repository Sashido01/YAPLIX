import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Fault} from './contracts.ts';
import type {GameSpec} from './contracts.ts';
import {PROJECT_ROOT} from './store.ts';
import type {Store} from './store.ts';
export const gallery=[{id:'ember-blocks',title:'Искры в клетках',genre:'falling-blocks'},{id:'prism-maze',title:'Световой лабиринт',genre:'maze-chase'},{id:'arena-target',title:'Arena: Меткий бросок',genre:'target-accuracy'}] as const;
export function openGallery(store:Store,id:string){
  const item=gallery.find(game=>game.id===id);if(!item)throw new Fault('GALLERY_NOT_FOUND',404);
  const html=readFileSync(resolve(PROJECT_ROOT,'assets/games',item.id+'.html'),'utf8'),sha=createHash('sha256').update(html).digest('hex');
  const row=store.db.prepare("SELECT version_id FROM versions WHERE json_extract(metadata,'$.method')='authored' AND json_extract(metadata,'$.model')=? AND json_extract(metadata,'$.sha256')=? LIMIT 1").get(item.id,sha);
  if(row)return store.getVersion(String(row.version_id));
  const spec:GameSpec={prompt:item.title+' — авторская офлайн-игра, не LIVE',genre:item.genre,audience:'default',mechanics:[],controls:['keyboard','touch','pointer'],responsive:true,webview:true};
  return store.save(spec,{html,method:'authored',provider:'YAPLIX',model:item.id,generationStatus:'succeeded',validationStatus:'unverified'});
}
