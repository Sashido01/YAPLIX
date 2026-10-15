// TASK-016 gameplay evidence checker for the experimental orchestrator.
// Layered on the existing browser-check.ts mechanics: the same strict launch
// sandbox (OS-sandboxed Chromium, offline, secrets-free env, opaque iframe with
// the same CSP/UUID compat), but instead of the startup-input-pause gate it
// drives a real automated session toward the declared terminal conditions.
// Evidence levels, mutually exclusive:
//   VERIFIED     - proven by a real automated session in Chromium.
//   NOT VERIFIED - the condition could not be proven automatically within the
//                  probe budget (reported honestly, never treated as PASS).
//   FAILED       - proven broken (crash, dead input, missing controls).
// Pixel changes alone are NOT gameplay proof: gameplay requires corroborating
// state evidence (read-only HUD genre states or score events). No LLM calls.
import { resolve } from 'node:path';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Fault } from '../contracts.ts';
import { GAME_CSP, UUID_COMPAT } from '../runtime.ts';
import { PROJECT_ROOT } from '../store.ts';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(PROJECT_ROOT,'.local/playwright');
// Playwright creates its temporary browser profiles in the parent process.
const temp=resolve(PROJECT_ROOT,'.local/tmp');mkdirSync(temp,{recursive:true});
for(const key of ['TEMP','TMP','TMPDIR'])process.env[key]=temp;
const {chromium}=await import('playwright-core');

export type Evidence = 'VERIFIED' | 'NOT_VERIFIED' | 'FAILED';
export type Aspect =
  | 'html-runs' | 'input-works' | 'gameplay-observed'
  | 'win-reachable' | 'loss-reachable' | 'restart-works';

export interface GameplayAspect { aspect: Aspect; level: Evidence; detail?: string }

export interface GameplayReport {
  aspects: GameplayAspect[];
  /** Session event types observed in the real session (ordered). */
  events: string[];
  finalScore: number | null;
  notes: string[];
}

export interface SessionObservation {
  startWorks: boolean;
  /** Input caused at least one visible change (HUD text or canvas pixels). */
  inputChanged: boolean;
  /** Distinct HUD genre states observed. */
  hudStates: number;
  /** Number of score_changed events observed. */
  scoreEvents: number;
  ended: boolean;
  won: boolean;
  lost: boolean;
  finalScore: number | null;
  errors: string[];
  /** true/false after a real restart probe; null when the session never ended. */
  restartWorks: boolean | null;
  eventTypes: string[];
}

export interface GameplayRules {
  win: string | null;
  loss: string | null;
  objective: string | null;
}

/** Explicit scripted input steps. Arrows tap the real keyboard; rotate/drop/fire tap visible action buttons. */
export type SequenceStep = 'left' | 'right' | 'up' | 'down' | 'rotate' | 'drop' | 'fire' | 'hurry';

export interface GameplayCheckOptions {
  /** Max wall-clock seconds for the drive loop. Default 45. */
  budgetSeconds?: number;
  /** Explicit declared score target overriding banner parsing, when known. */
  scoreTarget?: number | null;
  /** Arrow keys held in rotation while driving (default left/right). */
  holdKeys?: ('ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown')[];
  /** Deterministic scripted sequence; overrides generic sweeps when present. */
  sequence?: SequenceStep[];
}

/** Parse a small declared target (score/lines/waves/items) out of rules text. */
export function parseTarget(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(?:цель|целев|target|goal|до)[^\d]{0,60}?(\d{1,5})/i);
  const n = m ? Number(m[1]) : null;
  if (n && n >= 1 && n <= 500) return n;
  const words: Record<string, number> = { 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5 };
  const w = text.match(/(?:target|goal)\s+(one|two|three|four|five)\b/i);
  return w ? words[w[1]!.toLowerCase()] ?? null : null;
}

/** Pure mapping of a real session observation to per-aspect evidence levels. */
export function summarizeSession(obs: SessionObservation, target: number | null): GameplayReport {
  const aspects: GameplayAspect[] = [];
  const notes: string[] = [];
  const cleanRun = obs.errors.length === 0;
  aspects.push({ aspect: 'html-runs', level: cleanRun ? 'VERIFIED' : 'FAILED', detail: cleanRun ? 'real session started without browser errors' : obs.errors.slice(0, 3).join(',') });
  aspects.push({
    aspect: 'input-works',
    level: !obs.startWorks ? 'FAILED' : obs.inputChanged ? 'VERIFIED' : 'NOT_VERIFIED',
    detail: !obs.startWorks ? 'Start did not begin a session' : obs.inputChanged ? 'keyboard/pointer input moved HUD/canvas state' : 'no visible input effect captured in probe',
  });
  const genre = obs.hudStates >= 3 || (obs.scoreEvents > 0 && obs.hudStates >= 2);
  aspects.push({
    aspect: 'gameplay-observed',
    level: genre ? 'VERIFIED' : 'NOT_VERIFIED',
    detail: genre ? obs.hudStates + ' distinct HUD states, ' + obs.scoreEvents + ' score changes' : 'pixel activity only; no state-level genre evidence',
  });
  aspects.push({
    aspect: 'win-reachable',
    level: obs.won ? 'VERIFIED' : 'NOT_VERIFIED',
    detail: obs.won ? 'real session reached game_won' : 'no game_won within probe budget' + (target !== null ? ' (declared target ' + target + ')' : ''),
  });
  aspects.push({
    aspect: 'loss-reachable',
    level: obs.lost ? 'VERIFIED' : 'NOT_VERIFIED',
    detail: obs.lost ? 'real session reached game_lost' : 'no game_lost within probe budget',
  });
  aspects.push({
    aspect: 'restart-works',
    level: !obs.ended ? 'NOT_VERIFIED' : obs.restartWorks === true ? 'VERIFIED' : obs.restartWorks === false ? 'FAILED' : 'NOT_VERIFIED',
    detail: !obs.ended ? 'session did not end in probe; restart not exercised' : obs.restartWorks === true ? 'fresh playable run started after restart' : 'restart produced no fresh playable run',
  });
  if (obs.errors.length) notes.push('browser errors: ' + obs.errors.slice(0, 4).join(', '));
  if (!obs.won && target !== null) notes.push('declared target ' + target + ' not reached in probe');
  return { aspects, events: obs.eventTypes, finalScore: obs.finalScore, notes };
}

interface Ev { type: string; data?: { score?: number } }
type Snap = () => Promise<string>;

export async function gameplayCheck(
  html: string,
  rules: GameplayRules,
  options: GameplayCheckOptions = {},
): Promise<GameplayReport> {
  const budgetMs = (options.budgetSeconds ?? 45) * 1000;
  const holdKeys = options.holdKeys ?? ['ArrowLeft', 'ArrowRight'];
  const sequence = options.sequence ?? null;
  const target = options.scoreTarget ?? parseTarget([rules.win, rules.objective, rules.loss].filter(Boolean).join(' '));
  if (!checkerBrowserReady()) throw new Fault('BROWSER_INSTALL_REQUIRED', 503);
  const deadline = AbortSignal.timeout(budgetMs + 12000); // launch + teardown margin
  const env=Object.fromEntries(['PATH','Path','SystemRoot','TEMP','TMP','TMPDIR','HOME','USERPROFILE','LOCALAPPDATA','DISPLAY','XDG_RUNTIME_DIR','LANG'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]!]));
  // Same strict Linux sandbox discipline as browser-check.ts. Never --no-sandbox.
  if(process.platform==='linux'){
    const helper=process.env.CHROME_DEVEL_SANDBOX??'/opt/google/chrome/chrome-sandbox';
    if(existsSync(helper)){
      const info=statSync(helper);
      if(!info.isFile()||info.uid!==0||(info.mode&0o4000)===0||(info.mode&0o022)!==0)throw new Fault('BROWSER_SANDBOX_CONFIGURATION',503);
      env.CHROME_DEVEL_SANDBOX=helper;
    }else if(process.env.CHROME_DEVEL_SANDBOX)throw new Fault('BROWSER_SANDBOX_CONFIGURATION',503);
  }
  const browserLaunchAbort=()=>void browserLaunchPromise!.then(b=>b.close().catch(()=>{}));
  const browserLaunchPromise: Promise<Awaited<ReturnType<typeof chromium.launch>>> =
    chromium.launch({channel:'chromium',headless:true,chromiumSandbox:true,timeout:8000,env}).catch(()=>{throw new Fault('BROWSER_SANDBOX_UNAVAILABLE',503);});
  deadline.addEventListener('abort',browserLaunchAbort,{once:true});
  const browser=await browserLaunchPromise;
  const startedAt=Date.now();
  const remaining=()=>Math.max(0,budgetMs-(Date.now()-startedAt));
  try {
    const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true,offline:true,serviceWorkers:'block',acceptDownloads:false});
    const page=await context.newPage();page.setDefaultTimeout(3500);
    const errors:string[]=[];let exception='';
    page.on('pageerror',error=>{errors.push('JAVASCRIPT_EXCEPTION');exception=error.message.slice(0,180);});
    page.on('console',message=>{if(message.type()==='error')errors.push('BROWSER_CONSOLE_ERROR');});
    page.on('dialog',dialog=>{errors.push('NATIVE_DIALOG');void dialog.dismiss();});
    context.on('page',popup=>{if(popup!==page){errors.push('POPUP');void popup.close().catch(()=>{});}});
    await context.route('**/*',route=>{errors.push('NETWORK_ATTEMPT');return route.abort();});
    // The same opaque-iframe bridge contract as browser-check.ts.
    const session={sessionId:randomUUID(),versionId:randomUUID()};
    await page.setContent('<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe id="check" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>');
    await page.evaluate(({html,session,csp,compat})=>{
      const frame=document.querySelector('iframe')!;(window as any).checkEvents=[];
      addEventListener('message',e=>{if(e.source===frame.contentWindow&&e.origin==='null'&&e.data?.channel==='yaplix'&&(window as any).checkEvents.length<256)(window as any).checkEvents.push(e.data.event);});
      frame.onload=()=>(frame.contentWindow as Window).postMessage({channel:'yaplix_init',protocolVersion:1,...session},'*');
      frame.srcdoc='<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="'+csp+'"><script>'+compat+'</script>'+html;
    },{html,session,csp:GAME_CSP,compat:UUID_COMPAT});
    const frameReady=await page.waitForFunction(()=>{
      const f=document.querySelector('iframe');
      return ((window as any).checkEvents.length>0)||!!(f&&f.contentDocument&&f.contentDocument.querySelector('[data-yaplix-start]'));
    },null,{timeout:8000}).then(()=>true).catch(()=>false);
    if(!frameReady){
      return summarizeSession({ startWorks:false,inputChanged:false,hudStates:0,scoreEvents:0,ended:false,won:false,lost:false,finalScore:null,errors:errors.length?errors.slice(0,6):['GAME_READY_TIMEOUT'],restartWorks:null,eventTypes:[] }, target);
    }
    const gameFrame=()=>page.frames().find(f=>f!==page.mainFrame())!;
    const snap: Snap=()=>gameFrame().evaluate(()=>{
      const c=document.querySelector('canvas');
      const hud=document.querySelector('output[data-yaplix-state]');
      return (c?c.toDataURL():'')+'|'+(hud?hud.textContent:'');
    });
    const readEvents=()=>page.evaluate(()=>(window as any).checkEvents as Ev[]);
    const debug=process.env.YAPLIX_GAMEPLAY_DEBUG==='1';
    const log=(msg:string)=>{if(debug)console.log('[gameplay-check]',msg);};
    const startButton=gameFrame().locator('[data-yaplix-start]');
    if(await startButton.count()!==1){
      return summarizeSession({ startWorks:false,inputChanged:false,hudStates:0,scoreEvents:0,ended:false,won:false,lost:false,finalScore:null,errors:['GAME_START_CONTROL_MISSING'],restartWorks:null,eventTypes:[] }, target);
    }
    await startButton.tap();
    const started=await page.waitForFunction(()=>(window as any).checkEvents.some((e:Ev)=>e.type==='game_started'),null,{timeout:4000}).then(()=>true).catch(()=>false);
    if(!started){
      return summarizeSession({ startWorks:false,inputChanged:false,hudStates:0,scoreEvents:0,ended:false,won:false,lost:false,finalScore:null,errors:errors.slice(0,6),restartWorks:null,eventTypes:[] }, target);
    }
    const sig0=await snap();
    const hudSeen=new Set<string>();
    const hudOf=(text:string)=>text.slice(text.indexOf('|')+1);
    hudSeen.add(hudOf(sig0));
    let inputChanged=false;
    let scoreEvents=0,won=false,lost=false,ended=false,finalScore: number|null=null;
    const apply=(evs:Ev[])=>{
      for(const ev of evs){
        if(ev.type==='score_changed'){scoreEvents++;const s=ev.data?.score;if(typeof s==='number')finalScore=s;}
        if(ev.type==='game_won')won=true;
        if(ev.type==='game_lost')lost=true;
        if(ev.type==='session_ended')ended=true;
      }
    };
    const tapAction=async(action:string)=>{
      const btn=gameFrame().locator('[data-yaplix-action="'+action+'"]');
      if(await btn.count()>=1)await btn.first().tap().catch(()=>{});
    };
    const observe=async()=>{
      const signature=await snap();
      if(signature!==sig0)inputChanged=true;
      hudSeen.add(hudOf(signature));
      apply(await readEvents());
    };
    // Scripted sequence: deterministic honest inputs, one step at a time.
    const SEQUENCE_KEYS: Record<string, string> = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' };
    const runSequence=async(steps:SequenceStep[])=>{
      for(const step of steps){
        if(ended||remaining()<=0||deadline.aborted)break;
        if(step==='hurry'){await page.waitForTimeout(500);}
        else if(step==='rotate'){await tapAction('rotate');}
        else if(step==='drop'){await tapAction('space');}
        else if(step==='fire'){await tapAction('fire');}
        else{
          const key=SEQUENCE_KEYS[step];
          await page.keyboard.down(key);
          await page.waitForTimeout(160);
          await page.keyboard.up(key);
        }
        await page.waitForTimeout(240);
        await observe();
      }
    };
    // Generic sweeps: hold a real key, tap a visible in-game action button.
    const genericSweep=async(idx:number)=>{
      const key=holdKeys[idx%holdKeys.length];
      await page.keyboard.down(key);
      await page.waitForTimeout(260);
      await page.keyboard.up(key);
      const actions=gameFrame().locator('[data-yaplix-action]');
      const count=await actions.count();
      if(count>0)await actions.nth(idx%Math.min(count,6)).tap().catch(()=>{});
      await page.waitForTimeout(220);
      await observe();
    };
    if(sequence){
      await runSequence(sequence);
    }else{
      // Input evidence phase: hold real keys, compare snapshot; fall back to
      // visible action button taps (touch evidence).
      for(const key of holdKeys){
        if(remaining()<=0)break;
        await page.keyboard.down(key);
        await page.waitForTimeout(320);
        await page.keyboard.up(key);
        if(await snap()!==sig0){inputChanged=true;break;}
      }
      if(!inputChanged&&remaining()>0){
        const actions=gameFrame().locator('[data-yaplix-action]');
        const count=Math.min(4,await actions.count());
        for(let i=0;i<count&&!inputChanged;i++){
          await actions.nth(i).tap().catch(()=>{});
          await page.waitForTimeout(160);
          if(await snap()!==sig0)inputChanged=true;
        }
      }
    }
    // Terminal drive loop until a real terminal event or budget exhaustion.
    let idx=0;
    while(!ended&&remaining()>0&&!deadline.aborted){
      await genericSweep(idx++);
    }
    // Passive stretch: stack overflow / enemy pursuit / timer losses surface
    // without input; bounded to a third of the remaining budget (max 12 s).
    if(!ended&&remaining()>0){
      const idleUntil=Date.now()+Math.min(12000,Math.max(3000,Math.round(remaining()/3)));
      while(!ended&&!deadline.aborted&&Date.now()<idleUntil){
        await page.waitForTimeout(400);
        apply(await readEvents());
      }
      hudSeen.add(hudOf(await snap()));
    }
    log('drive done: ended='+ended+' won='+won+' lost='+lost+' scoreEvents='+scoreEvents+' hudStates='+hudSeen.size);
    // Restart probe: only honest after a real terminal event.
    let restartWorks: boolean|null=null;
    if(ended&&!deadline.aborted){
      try{
        const beforeCount=(await readEvents()).length;
        const restart=gameFrame().locator('[data-yaplix-restart]');
        if(await restart.count()===1){
          await restart.tap().catch(()=>{});
          await page.waitForTimeout(1400); // reload + bridge re-init
          const afterEvents=await readEvents();
          const freshReady=afterEvents.length>beforeCount&&afterEvents.slice(beforeCount).some(e=>e.type==='game_ready');
          if(freshReady){
            const freshStart=gameFrame().locator('[data-yaplix-start]');
            if(await freshStart.count()===1){
              await freshStart.tap().catch(()=>{});
              await page.waitForTimeout(700);
              const after2=await readEvents();
              restartWorks=after2.length>afterEvents.length&&after2.slice(afterEvents.length).some(e=>e.type==='game_started')&&!errors.some(e=>e==='JAVASCRIPT_EXCEPTION');
            } else restartWorks=false;
          } else restartWorks=false;
        } else restartWorks=false;
      }catch{restartWorks=false;}
    }
    // Post-restart stretch: a fresh session played badly can surface the loss
    // condition (idle crash into walls/overflow) within a bounded window.
    if(restartWorks===true&&!lost&&remaining()>0&&!deadline.aborted){
      const idleUntil=Date.now()+Math.min(9000,remaining());
      while(!lost&&!deadline.aborted&&Date.now()<idleUntil){
        await page.waitForTimeout(400);
        apply(await readEvents());
      }
    }
    if(exception)errors.push('EXCEPTION:'+exception);
    log('restart probe: '+String(restartWorks)+', errors='+errors.join(','));
    return summarizeSession({
      startWorks:true,
      inputChanged,
      hudStates:hudSeen.size,
      scoreEvents,
      ended,won,lost,
      finalScore,
      errors:errors.slice(0,6),
      restartWorks,
      eventTypes:(await readEvents()).map(ev=>ev.type),
    }, target);
  } catch (error) {
    if (error instanceof Fault) return { aspects: [{ aspect: 'html-runs', level: 'FAILED', detail: 'checker fault ' + error.code }], events: [], finalScore: null, notes: [error.code] };
    return { aspects: [{ aspect: 'html-runs', level: 'FAILED', detail: 'unexpected checker error' }], events: [], finalScore: null, notes: [String(error).slice(0, 200)] };
  } finally { deadline.removeEventListener('abort',browserLaunchAbort); await browser.close().catch(()=>{}); }
}

function checkerBrowserReady(){ return existsSync(chromium.executablePath()); }
