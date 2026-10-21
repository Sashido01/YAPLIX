/** Version-bound tournament semantics, not a certificate of gameplay or cheat resistance. */
export const arenaMetrics = {
  score: {label:'Очки',direction:'higher',unit:'points'},
  'completion-time': {label:'Время прохождения',direction:'lower',unit:'ms'},
  distance: {label:'Дистанция',direction:'higher',unit:'m'},
  survival: {label:'Время выживания',direction:'higher',unit:'ms'},
} as const;
export type ArenaMetric = {id:keyof typeof arenaMetrics;label:string;direction:'higher'|'lower';unit:string;protocol:'score-v1'|'result-v1'};
/** A declaration selects semantics; it does not certify gameplay or prevent cheating. */
export function arenaMetric(html:string):ArenaMetric|null {
  const declarations=[...html.matchAll(/<meta\s+name=["']yaplix-arena["']\s+content=["']([^"']+)["']\s*\/?>/gi)];
  if(declarations.length!==1)return null;
  const content=declarations[0][1];
  if(content==='score-v1')return {id:'score',...arenaMetrics.score,protocol:'score-v1'};
  const id=content.startsWith('result-v1:')?content.slice(10):'';
  if(!Object.hasOwn(arenaMetrics,id))return null;
  return {id:id as ArenaMetric['id'],...arenaMetrics[id as ArenaMetric['id']],protocol:'result-v1'};
}
export function arenaDeclared(html: string): boolean {return arenaMetric(html)!==null;}
export function formatArenaValue(value:number,metric:Pick<ArenaMetric,'unit'>):string {
  return metric.unit==='ms'?(value/1000).toFixed(3)+' с':metric.unit==='m'?value+' м':String(value);
}
export function arenaGoalRequired(html:string):boolean {
  const declarations=[...html.matchAll(/<meta\s+name=["']yaplix-arena["']\s+content=["']([^"']+)["']\s*\/?>/gi)];
  return declarations.length===1&&declarations[0][1]==='goal-required-v1';
}

export const UNIVERSAL_ARENA_CONTRACT = `Arena is automatic: add <meta name="yaplix-arena" content="result-v1:score"> (max points), result-v1:completion-time (min active ms, only game_won), result-v1:distance (max metres), or result-v1:survival (max active ms). Choose from real mechanics. Do not invent points, lives, win/loss or override user rules. Without a measurable goal declare goal-required-v1 instead; the owner defines a tournament objective in a separate version. Edits preserve the existing metric/score-v1 bridge unless explicitly changed. Listen once for source===parent, channel yaplix_init, protocolVersion 1; retain sessionId/versionId. Send parent.postMessage({channel:'yaplix',event:{protocolVersion:1,eventId:crypto.randomUUID(),sessionId,versionId,sequence,timestamp:Date.now(),type,data}},'*'). Sequence: game_ready=0, game_started=1 on actual Start, result_changed with data:{value}, optional game_won/game_lost, exactly one session_ended. Other data={}. Value: integer 0..1e9, positive ms. Final result precedes terminal events, only after real gameplay; never from Start alone, random values, idle elapsed time or pixels. Throttle to 20 events/s and 1000/attempt. If init.arena, use outer New attempt. No endpoint calls or parent DOM; offline without parent still plays.`;
