import {createHash} from 'node:crypto';
import {Fault} from './contracts.ts';
import type {Store} from './store.ts';
import {arenaDeclared} from './arena-contract.ts';

// Exact independently authored historical sources only. Never infer score from pixels,
// names or arbitrary JS. A changed source deliberately falls back to explicit LLM preparation.
const known=new Set(['18b0ae7925cf163ac685c7d97a5e1d99d4cb60b8b24dc94864672ef2903807ca','ac7b470f1d4e9658c0956f8358c86464a0cb0385e5f6fd91e6955c54516f3856']);
export function localArenaHtml(html:string):string|null {
  if(!known.has(createHash('sha256').update(html).digest('hex')))return null;
  return html.replace('<head>','<head><meta name="yaplix-arena" content="result-v1:score">')
    .replace("function start(){cancelAnimationFrame(raf);","function start(){if(telemetry.session?.arena&&everStarted)return;cancelAnimationFrame(raf);")
    .replace("report('game_started');","report('game_started');report('result_changed',{value:0});")
    .replaceAll("report('score_changed',{score});","report('result_changed',{value:score});")
    .replace("report(won?'game_won':'game_lost');","report('result_changed',{value:score});report(won?'game_won':'game_lost');");
}
export function prepareLocalArena(store:Store,versionId:string){
  const original=store.getVersion(versionId);
  if(arenaDeclared(original.html))return original;
  const html=localArenaHtml(original.html);
  if(!html)throw new Fault('ARENA_LLM_PREPARATION_REQUIRED',409);
  const existing=store.history(original.gameId).find(v=>v.previousVersionId===original.versionId&&v.sha256===createHash('sha256').update(html).digest('hex'));
  if(existing)return store.getVersion(existing.versionId);
  // New source has not inherited browser/LLM evidence from its parent.
  return store.save(original.spec,{html,method:'authored',provider:'YAPLIX',model:'arena-local-adapter',generationStatus:'succeeded',validationStatus:'unverified'},original.versionId);
}
export function arenaPreparationPrompt(goal:unknown){
  if(typeof goal!=='string'||goal.trim().length<10||goal.length>200)throw new Fault('ARENA_GOAL_REQUIRED');
  // The system contract supplies bridge details; the user-facing version title stays readable.
  return 'Турнирная цель Arena: '+goal.trim();
}
