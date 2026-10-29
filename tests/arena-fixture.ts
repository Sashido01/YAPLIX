import { readFileSync } from 'node:fs';
import { artifact, spec } from './helpers.ts';
import type { Store } from '../src/store.ts';

const html=readFileSync(new URL('./fixtures/games/arena-target.html',import.meta.url),'utf8');
export function saveArenaFixture(store:Store){return store.save(spec,{...artifact,html,method:'authored',provider:'YAPLIX',model:'arena-target'});}
export function saveUserArenaTestFixture(store:Store){return store.save(spec,{...artifact,html,method:'mock',provider:'test-only-synthetic',model:null});}
