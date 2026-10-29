import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gameIntent, inferredGameBrief } from '../src/game-intent.ts';
import { GAME_VOCABULARY, VOCABULARY_VERSION } from '../src/game-vocabulary.ts';
import { prepareGenerationMessages } from '../src/generation.ts';
import { safeTrace } from '../src/generation-trace.ts';
import { randomUUID } from 'node:crypto';

const cases=JSON.parse(readFileSync(new URL('../docs/nl-evaluation/vocabulary-dev.json',import.meta.url),'utf8')) as {text:string;archetypes:string[]}[];
const spec=(prompt:string)=>({prompt,genre:'unknown',audience:'default',mechanics:[],controls:['keyboard','touch','pointer'],responsive:true,webview:true});

test('the development vocabulary set has at least 100 independent short cases',()=>{
 assert.ok(cases.length>=100,`found ${cases.length}`);
 assert.equal(new Set(cases.map(x=>x.text)).size,cases.length);
});

test('recognized archetypes match the declared short-query vocabulary set',()=>{
 const misses:string[]=[],falsePositives:string[]=[];
 for(const item of cases){
  const actual=gameIntent(item.text).archetypes.map(x=>x.value).filter((x):x is string=>Boolean(x)).sort();
  const expected=[...item.archetypes].sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected))(expected.length?misses:falsePositives).push(`${item.text}: expected ${expected.join(',')||'UNKNOWN'}, got ${actual.join(',')||'UNKNOWN'}`);
 }
 assert.deepEqual({misses,falsePositives},{misses:[],falsePositives:[]});
});

test('vocabulary identifiers and aliases are stable and unique',()=>{
 assert.ok(VOCABULARY_VERSION);
 assert.ok(GAME_VOCABULARY.length>=25);
 assert.equal(new Set(GAME_VOCABULARY.map(x=>x.id)).size,GAME_VOCABULARY.length);
 for(const entry of GAME_VOCABULARY){
  assert.ok(entry.aliases.length>0,entry.id);
  assert.ok(entry.mechanics.length>0,entry.id);
  assert.ok(entry.compatibleWith.length>0,entry.id);
  assert.ok(entry.description.length>0,entry.id);
 }
});

test('negative clauses and quoted title text do not become inferred game rules',()=>{
 const intent=gameIntent('Не змейка, а игра про море. Надпись «тетрис» на коробке.');
 assert.deepEqual(intent.archetypes,[]);
 assert.equal(gameIntent('Тетрис без поворотов и таймера.').mechanics.some(x=>x.value==='piece_rotation'),false);
 assert.equal(gameIntent('Арканоид без очков.').mechanics.some(x=>x.value==='score'),false);
 const decomposed='Сделай сапе\u0308ра для телефона';
 const normalized=gameIntent(decomposed);
 assert.ok(normalized.archetypes.some(x=>x.value==='minesweeper'));
 assert.ok(decomposed.includes(normalized.archetypes.find(x=>x.value==='minesweeper')!.evidence!));
 const audience=gameIntent('Змейка для бабушки');
 assert.equal(audience.audience.value,'elderly');assert.equal(audience.audience.source,'INFERRED');
 assert.match(inferredGameBrief(audience)!,/do not assume medical needs/);
});

test('explicit bans suppress only inferred mechanics and retain the original rule text',()=>{
 const text='Арканоид без очков и таймера. Змейка без еды и роста. Тетрис без поворотов.';
 const intent=gameIntent(text),all=new Set(intent.mechanics.map(x=>x.value));
 assert.ok(intent.constraints.some(x=>x.value==='no_timer'));
 assert.ok(intent.constraints.some(x=>x.value==='no_score'));
 assert.ok(!all.has('score')&&!all.has('piece_rotation')&&!all.has('food_collection')&&!all.has('growth'));
 assert.equal(intent.originalRequest,text);
 assert.equal(intent.requirements.map(x=>x.value).join(' '),text);
 assert.ok(!gameIntent('Космический шутер без стрельбы').mechanics.some(x=>x.value==='shooting'));
 assert.ok(!gameIntent('Платформер без прыжков').mechanics.some(x=>x.value==='jumping'));
 assert.ok(!gameIntent('Tower defense without enemies').mechanics.some(x=>x.value==='enemy_path'));
});

test('an explicitly named multi-archetype idea is preserved in one compact prompt and trace',()=>{
 const text='Арканоид и тетрис для телефона без таймера.';
 const prepared=prepareGenerationMessages(spec(text) as any);
 assert.equal(prepared.messages.length,2);
 assert.ok(prepared.messages[1].content.includes(text));
 assert.match(prepared.messages[1].content,/Move a paddle/);
 assert.match(prepared.messages[1].content,/falling tetrominoes/);
 assert.equal(prepared.messages[1].content.split(text).length-1,1);
 assert.ok(prepared.vocabulary.archetypeId?.includes('brick_breaker'));
 assert.ok(prepared.vocabulary.archetypeId?.includes('falling_blocks'));
 const trace=safeTrace('prompt.prepared',randomUUID(),{details:prepared.vocabulary});
 const serialized=JSON.stringify(trace);
 for(const key of ['vocabularyVersion','archetypeId','genreId','appliedRuleCount','ruleSources','suppressedAssumptionCount','hintBytes','classificationMs'])assert.ok(serialized.includes(key));
 assert.ok(!serialized.includes(text));
 const compact=prepareGenerationMessages(spec(text) as any,undefined,'intent');
 assert.equal(compact.messages.length,2);
 const payload=JSON.parse(compact.messages[1].content);
 assert.deepEqual(payload.INFERRED.archetypes,['brick_breaker','falling_blocks']);
 assert.equal(payload.request,text);
 assert.ok(payload.EXPLICIT.constraints.includes('no_timer'));
});
