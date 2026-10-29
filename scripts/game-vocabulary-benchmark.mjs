import { readFileSync, statSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { gameIntent } from '../src/game-intent.ts';
import { GAME_AUDIENCES, GAME_CONSTRAINTS, GAME_GENRES, GAME_MECHANICS, GAME_PRESENTATION, GAME_VOCABULARY, VOCABULARY_VERSION } from '../src/game-vocabulary.ts';
import { prepareGenerationMessages } from '../src/generation.ts';

const rows=JSON.parse(readFileSync(new URL('../docs/nl-evaluation/vocabulary-dev.json',import.meta.url),'utf8'));
const makeSpec=prompt=>({prompt,genre:'unknown',audience:'default',mechanics:[],controls:['keyboard','touch','pointer']});
const oldRules=[
 ['snake',/змейк/iu],['falling_blocks',/тетрис/iu],['endless_runner',/раннер/iu],['maze',/лабиринт/iu],
 ['platformer',/платформир/iu],['racing',/гонк/iu],['puzzle',/головоломк|пазл/iu],['clicker',/кликер/iu],
];
function baselineArchetypes(text){return oldRules.flatMap(([id,regex])=>regex.test(text)?[id]:[]);}
function baselineHint(text){
 const values=[];if(/змейк/iu.test(text))values.push('snake_movement','food_collection','growth','snake_collision','score');
 if(/тетрис/iu.test(text))values.push('falling_blocks','line_clear','piece_rotation');if(/раннер/iu.test(text))values.push('running','obstacle_avoidance');if(/кликер/iu.test(text))values.push('clicking');
 const brief=[];
 if(/змейк/iu.test(text)){const parts=['start and restart'];for(const [id,label]of [['snake_movement','continuous grid movement'],['food_collection','food collection'],['growth','growth after eating'],['snake_collision','collision and loss only if compatible with explicit rules'],['score','visible food count']])if(values.includes(id))brief.push(label);return 'Classic Snake loop: '+parts.concat(brief).join(', ')+'.';}
 if(/тетрис/iu.test(text)){const actions=['move and place blocks'];if(values.includes('piece_rotation'))actions.push('rotate pieces');return 'Tetris loop: falling tetrominoes, '+actions.join(', ')+', completed rows disappear, the board updates after each placement, and restart; do not invent a score target or forced victory.';}
 if(/гонк/iu.test(text))return 'Racing loop: steer and control speed on a readable course, show the vehicle and track clearly, and make each input affect motion; add laps, timer, score or finish rules only when requested or clearly implied.';
 if(/головоломк|пазл/iu.test(text))return 'Puzzle loop: present a legible board and a real player action that changes its state, show relevant progress, and provide a way to retry; do not assume a matching rule, timer, score or win condition absent from the request.';
 return null;
}
const matched=rows.map(row=>({row,expected:[...row.archetypes].sort(),baseline:baselineArchetypes(row.text).sort(),current:gameIntent(row.text).archetypes.map(x=>x.value).filter(Boolean).sort()}));
const score=field=>{let tp=0,fp=0,fn=0,exact=0,unknownCorrect=0;for(const item of matched){const actual=item[field],expected=item.expected;tp+=actual.filter(x=>expected.includes(x)).length;fp+=actual.filter(x=>!expected.includes(x)).length;fn+=expected.filter(x=>!actual.includes(x)).length;if(JSON.stringify(actual)===JSON.stringify(expected))exact++;if(!expected.length&&!actual.length)unknownCorrect++;}return {exactQueries:exact,queryAccuracyPct:+(100*exact/rows.length).toFixed(1),truePositive:tp,falsePositive:fp,falseNegative:fn,precisionPct:+(100*tp/Math.max(1,tp+fp)).toFixed(1),recallPct:+(100*tp/Math.max(1,tp+fn)).toFixed(1),unknownCorrect};};
const hintBefore=rows.map(row=>Buffer.byteLength(baselineHint(row.text)??''));
const hintAfter=rows.map(row=>prepareGenerationMessages(makeSpec(row.text)).vocabulary.hintBytes);
for(let i=0;i<5;i++)for(const row of rows)gameIntent(row.text);
const timings=[];for(let repeat=0;repeat<7;repeat++)for(const row of rows){const started=performance.now();gameIntent(row.text);timings.push(performance.now()-started);}timings.sort((a,b)=>a-b);
const sum=values=>values.reduce((a,b)=>a+b,0),percentile=(values,p)=>values[Math.floor(values.length*p)];
const termCount=terms=>terms.length,aliasCount=terms=>terms.reduce((sum,term)=>sum+term.aliases.length,0);
console.log(JSON.stringify({node:process.version,version:VOCABULARY_VERSION,queries:rows.length,baseline:score('baseline'),candidate:score('current'),catalog:{archetypes:termCount(GAME_VOCABULARY),genres:termCount(GAME_GENRES),mechanicTerms:termCount(GAME_MECHANICS),audiences:termCount(GAME_AUDIENCES),presentation:termCount(GAME_PRESENTATION),constraints:termCount(GAME_CONSTRAINTS),aliases:{archetypes:aliasCount(GAME_VOCABULARY),genres:aliasCount(GAME_GENRES),mechanics:aliasCount(GAME_MECHANICS),audiences:aliasCount(GAME_AUDIENCES),presentation:aliasCount(GAME_PRESENTATION),constraints:aliasCount(GAME_CONSTRAINTS)}},archetypesBefore:oldRules.length,archetypesAfter:GAME_VOCABULARY.length,additionalHintBytes:{beforeAverage:+(sum(hintBefore)/rows.length).toFixed(1),afterAverage:+(sum(hintAfter)/rows.length).toFixed(1),beforeP95:percentile([...hintBefore].sort((a,b)=>a-b),.95),afterP95:percentile([...hintAfter].sort((a,b)=>a-b),.95)},classificationMs:{samples:timings.length,p50:+percentile(timings,.5).toFixed(3),p95:+percentile(timings,.95).toFixed(3),max:+timings.at(-1).toFixed(3)},codeBytes:{vocabulary:statSync(new URL('../src/game-vocabulary.ts',import.meta.url)).size}},null,2));
