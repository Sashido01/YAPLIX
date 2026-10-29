import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/api.ts';
import {Store} from '../src/store.ts';
import {saveArenaFixture} from './arena-fixture.ts';
import {artifact,spec} from './helpers.ts';

test('the production API does not publish a built-in game gallery',async()=>{
  const store=new Store(':memory:');
  try{
    const app=createApp(store);
    assert.equal((await app.request('/api/gallery')).status,404);
    assert.equal((await app.request('/api/gallery/prism-maze',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,404);
    assert.deepEqual((await(await app.request('/api/games')).json() as {games:unknown[]}).games,[]);
  }finally{store.close();}
});

test('the production API rejects demo generation mode',async()=>{
  const store=new Store(':memory:');
  try {
    const app=createApp(store);
    const response=await app.request('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'demo'})});
    assert.equal(response.status,400);
    assert.equal((await response.json() as {error:string}).error,'INVALID_MODE');
  } finally { store.close(); }
});

test('only an exact archived system-authored fixture is hidden; unproven user data remains visible',async()=>{
  const store=new Store(':memory:');
  try {
    const legacy=saveArenaFixture(store),user=store.save(spec,artifact),app=createApp(store);
    const listed=(await(await app.request('/api/games')).json() as {games:{versionId:string}[]}).games;
    assert.deepEqual(listed.map(game=>game.versionId),[user.versionId]);
    assert.equal((await app.request('/api/versions/'+legacy.versionId)).status,404);
    assert.equal((await app.request('/api/versions/'+user.versionId)).status,200);
  } finally { store.close(); }
});
