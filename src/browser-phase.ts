import type {TraceData,TraceStatus} from './generation-trace.ts';

type Trace=(event:string,data?:TraceData)=>void;
const PHASE=/^[a-z][a-z0-9-]{0,31}$/;

/** Metadata-only duration recorder for bounded validator phases. */
export function browserPhaseTracker(trace:Trace,viewport:string){
 let current:string|undefined,startedAt=0,index=0;
 const finish=(status:TraceStatus='PASS',errorCode?:string,reasonCode?:string)=>{
  if(!current)return;
  trace('browser.phase.completed',{status,durationMs:Math.max(0,Math.round(performance.now()-startedAt)),errorCode,details:{phase:current,phaseIndex:index,viewport,...(reasonCode?{reasonCode}:{})}});
  current=undefined;
 };
 const start=(phase:string)=>{
  if(!PHASE.test(phase))throw new Error('INVALID_BROWSER_PHASE');
  finish();current=phase;startedAt=performance.now();index++;
  trace('browser.phase.started',{status:'STARTED',details:{phase,phaseIndex:index,viewport}});
 };
 return{start,finish,get current(){return current;}};
}
