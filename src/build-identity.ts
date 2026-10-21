import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {PROJECT_ROOT} from './store.ts';
export function buildIdentity(){
  const hash=createHash('sha256');
  const walk=(directory:string)=>{for(const item of readdirSync(resolve(PROJECT_ROOT,directory),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const name=directory+'/'+item.name;if(item.isDirectory())walk(name);else if(item.isFile()&&/\.(ts|html|css|js)$/.test(item.name))hash.update(name+'\0').update(readFileSync(resolve(PROJECT_ROOT,name)));}};
  walk('src');walk('assets');walk('build/public');hash.update(readFileSync(resolve(PROJECT_ROOT,'scripts/windows-lan-setup.ps1')));return hash.digest('hex');
}
