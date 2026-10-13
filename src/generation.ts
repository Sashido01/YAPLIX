import { Fault, MAX_HTML_BYTES, parseSpec } from './contracts.ts';
import type { GameSpec, GameVersion } from './contracts.ts';
import type { Message } from './transport.ts';

// Independently authored against YAPLIX's own runtime/event v1 contracts.
export const eventBridge = `const telemetry={session:null,next:0,ended:false};
function report(type,data={}){if(!telemetry.session||telemetry.ended||parent===window)return;parent.postMessage({channel:'yaplix',event:{protocolVersion:1,eventId:crypto.randomUUID(),sessionId:telemetry.session.sessionId,versionId:telemetry.session.versionId,sequence:telemetry.next++,timestamp:Date.now(),type,data}},'*');if(type==='session_ended')telemetry.ended=true;}
addEventListener('message',({source,data})=>{if(source===parent&&data?.channel==='yaplix_init'&&data.protocolVersion===1&&!telemetry.session){telemetry.session=data;report('game_ready');}});`;
export function specification(spec: GameSpec, previous?: GameVersion) {
  parseSpec(spec);
  return { request:spec.prompt, genre:spec.genre, mechanics:spec.mechanics, audience:spec.audience, controls:spec.controls,
    victory:'Implement the requested victory rule; otherwise choose a visible, achievable goal.', defeat:'Implement the requested loss rule; otherwise choose a meaningful avoidable failure.',
    display:{minimumWidth:320,landscape:true,devicePixelRatio:true,touchTargetPx:44,safeArea:true}, standalone:true,
    ...(previous ? { originalRequest:previous.spec.prompt, modification:true } : {}) };
}
export function generationMessages(spec: GameSpec, previous?: GameVersion): Message[] {
  return [ {role:'system',content:`You write original playable browser games for YAPLIX. Return one complete HTML document, beginning <!DOCTYPE html>, containing inline CSS/JavaScript and ending </html>. Invent mechanics from the user's description; no fixed genre catalog or template selector. Include a title, visible rules, score, understandable win/loss and restart. Canvas 2D is preferred. No downloads, networking, imports, eval, dialogs, workers or external resources. Use DOM textContent rather than constructing HTML from input.
Include <meta name="viewport" content="width=device-width,initial-scale=1">. The game must fit a 320px phone and landscape. Size canvas ancestors explicitly, draw before Start, use CSS units for logical positions and DPR only for backing resolution. Initialize all state before calling setup or draw. Animate only while playing using one requestAnimationFrame loop, capped dt in seconds. Pause when hidden; resume retains score, world and timing without starting another loop. Movement, collision and progress must visibly follow real keyboard and pointer/touch input. Controls remain visible and usable when overlays appear. Keep the HTML concise, below 400 lines; output code without analysis or commentary.
Mark exactly ONE initial Start button data-yaplix-start (never mark Restart), ONE Pause/resume button data-yaplix-pause and a gameplay control or canvas data-yaplix-input. ALL buttons require CSS min-height:44px; the start/input elements must lie entirely within the viewport. Start must be a real user action, never automatic. Initial overlay must not block Start. These attributes are checked in an isolated browser. The same game must run offline without its parent.
Use this event v1 bridge exactly (the platform supplies crypto.randomUUID compatibility on LAN):\n${eventBridge}
Call report('game_started') only on the FIRST real start after init, report('score_changed',{score}) on actual score changes, report('game_won') or report('game_lost') for one real terminal result followed by report('session_ended'). Lifecycle data is empty. Never fabricate sessions or send init yourself. Internal restart still plays standalone; after session_ended it must not send further events. The host's Replay reloads the iframe for a new tracked session. Do not read the parent DOM.` },
    {role:'user',content:JSON.stringify(specification(spec,previous)) + (previous ? '\nPrevious complete game to modify; preserve its working mechanics:\n'+previous.html : '')} ];
}
export function extractDocument(text: string) {
  const matches=[...text.matchAll(/<!doctype\s+html[\s\S]*?<\/html>/gi)];
  if(matches.length!==1)throw new Fault('LLM_INVALID_HTML',502);
  const html=matches[0][0];
  if(Buffer.byteLength(html)>MAX_HTML_BYTES)throw new Fault('ARTIFACT_TOO_LARGE',413);
  return html;
}
export function validateDocument(html: string): string[] {
  const problems:string[]=[];
  if(!/^<!doctype html>/i.test(html)||!/<html\b/i.test(html)||!/<body\b/i.test(html)||!/<script\b/i.test(html))problems.push('HTML_STRUCTURE');
  if(!/<meta\b[^>]*name\s*=\s*["']viewport["'][^>]*content\s*=\s*["'][^"']*width=device-width/i.test(html))problems.push('MOBILE_VIEWPORT_MISSING');
  if(/<(?:script|iframe|object|embed|link|base|form)\b[^>]*(?:src|href|action)\s*=/i.test(html)||/\b(?:src|href|poster)\s*=\s*["']?\s*(?:https?:|\/\/|javascript:)/i.test(html)||/@import\b|url\s*\(\s*["']?\s*(?:https?:|\/\/)/i.test(html))problems.push('EXTERNAL_RESOURCE');
  if(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|Worker|SharedWorker|importScripts|eval|alert|confirm|prompt)\s*\(|\bnew\s+Function\b|\bimport\s*(?:\(|[{*])|\brequire\s*\(|\b(?:location|parent|top)\s*\.\s*(?:href|location|document)\b|<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i.test(html))problems.push('FORBIDDEN_EXECUTION');
  if(!/addEventListener\s*\(/.test(html)||!/(?:pointer|touch|keydown|keyup|click)/i.test(html)||!/(?:requestAnimationFrame|function\s+draw|function\s+render)/.test(html))problems.push('GAME_LOOP_OR_INPUT_MISSING');
  for(const attr of ['data-yaplix-start','data-yaplix-input','data-yaplix-pause'])if(!html.includes(attr))problems.push('MISSING_'+attr.toUpperCase());
  return problems;
}
