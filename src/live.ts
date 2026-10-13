import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Fault, parseArtifact, parseSpec, MAX_HTML_BYTES } from './contracts.ts';
import type { Artifact, GameSpec, GameVersion } from './contracts.ts';
import { boundedText, BGenAdapter } from './bgen.ts';
import type { Generator } from './bgen.ts';
import { PROJECT_ROOT, managedPath } from './store.ts';

export const BGEN_REVISION = '419c64968d487068a2fbed2e4bd99489cc734430';
export const BGEN_ROOT = resolve(PROJECT_ROOT, '.local/BGen');
interface Compiler { compile(input: { prompt: string; audience: string; theme: string }, options: { previousCode?: string; previousPrompt?: string }): { system: string; user: string; spec: { genre: string } } }
interface Extractor { extractGame(text: string): { html: string } }
interface Security { checkSecurity(html: string): { severity: string; id: string; hint?: string }[] }
interface PromptBlocks { HARD_RULES_BLOCK: string; OUTPUT_FORMAT_BLOCK: string; QUALITY_REMINDER: string }
export function checkBGen() {
  managedPath('.local/BGen/core/src/prompt/compiler.ts', false);
  if (!existsSync(resolve(BGEN_ROOT, 'core/src/prompt/compiler.ts'))) throw new Fault('BGEN_INSTALL_REQUIRED', 503);
  try {
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: BGEN_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (revision !== BGEN_REVISION) throw new Fault('BGEN_REVISION_MISMATCH', 503);
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'core/src'], { cwd: BGEN_ROOT, stdio: 'pipe' });
  } catch (e) { if (e instanceof Fault) throw e; throw new Fault('BGEN_SOURCE_CHANGED', 503); }
}
async function modules() {
  checkBGen();
  // Only prompt/extraction/security modules. Never imports router, templates or GigaChat.
  const compiler: Compiler = await import(pathToFileURL(resolve(BGEN_ROOT, 'core/src/prompt/compiler.ts')).href);
  const extractor: Extractor = await import(pathToFileURL(resolve(BGEN_ROOT, 'core/src/analyze/extractor.ts')).href);
  const security: Security = await import(pathToFileURL(resolve(BGEN_ROOT, 'core/src/analyze/security.ts')).href);
  const blocks: PromptBlocks = await import(pathToFileURL(resolve(BGEN_ROOT, 'core/src/prompt/blocks.ts')).href);
  const genres: { genreRule(genre: string): string | undefined } = await import(pathToFileURL(resolve(BGEN_ROOT, 'core/src/prompt/genres.ts')).href);
  return { compiler, extractor, security, blocks, genres };
}
export class LocalCodeAdapter implements Generator {
  readonly provider = 'ollama';
  readonly url: string;
  readonly model: string;
  private timeout: number;
  private busy = false;
  private active: AbortController | undefined;
  close() { this.active?.abort(); }
  constructor(options: { url?: string; model?: string; timeoutMs?: number } = {}) {
    let url: URL;
    try { url = new URL(options.url ?? 'http://127.0.0.1:11434'); } catch { throw new Fault('INVALID_LLM_URL'); }
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Fault('INSECURE_LLM_URL');
    this.url = url.origin; this.model = options.model ?? 'qwen2.5-coder:14b'; this.timeout = options.timeoutMs ?? 180_000;
    if (!this.model.trim() || this.model.length > 128 || !Number.isSafeInteger(this.timeout) || this.timeout < 1 || this.timeout > 300_000) throw new Fault('INVALID_LLM_CONFIGURATION');
  }
  async modelState(signal?: AbortSignal): Promise<'ready' | 'unreachable' | 'model_missing'> {
    try {
      const deadline = AbortSignal.timeout(3000);
      const response = await fetch(`${this.url}/api/tags`, { redirect: 'error', signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
      const data = JSON.parse(await boundedText(response, 100_000));
      if (!response.ok || !Array.isArray(data.models)) return 'unreachable';
      return data.models.some((model: { name?: string }) => model.name === this.model) ? 'ready' : 'model_missing';
    } catch { return 'unreachable'; }
  }
  async generate(spec: GameSpec, previous?: GameVersion, requiredMethod?: 'llm_code', signal?: AbortSignal): Promise<Artifact> {
    parseSpec(spec);
    if (requiredMethod !== undefined && requiredMethod !== 'llm_code') throw new Fault('INVALID_REQUIRED_METHOD');
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Fault('INSECURE_TLS_CONFIGURATION', 503);
    if (this.busy) throw new Fault('LLM_BUSY', 409);
    this.busy = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.timeout);
    this.active = controller;
    const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    try {
      const { compiler, extractor, security, blocks, genres } = await modules();
      // Empty explicit theme prevents substring inference such as победа -> еда.
      // The complete original theme/request still reaches the model verbatim.
      const compiled = compiler.compile({ prompt: spec.prompt, audience: spec.audience, theme: '' }, previous ? { previousCode: previous.html, previousPrompt: previous.spec.prompt } : {});
      // Pinned BGen's host blocks require external bgen:input buttons and an
      // unconditional animation loop. YAPLIX's standalone/opaque runtime has
      // different contracts. Replace those whole exported blocks, preserving
      // the compiler's classifier, genre, audience, mechanics and iteration.
      let system = compiled.system;
      const requestedGenre = genres.genreRule(spec.genre);
      const genre = spec.genre !== 'unknown' && typeof requestedGenre === 'string' ? spec.genre : /арканоид|arkanoid|breakout|кирпич/iu.test(spec.prompt) ? 'breakout' : compiled.spec.genre;
      if (genre !== compiled.spec.genre) {
        const inferred = genres.genreRule(compiled.spec.genre), selected = genres.genreRule(genre);
        if (!inferred || !selected || !system.includes(inferred)) throw new Fault('BGEN_PROMPT_CONTRACT_CHANGED', 503);
        system = system.replace(inferred, selected);
        const offset = compiled.user.lastIndexOf('РАЗОБРАННАЯ СПЕЦИФИКАЦИЯ');
        if (offset < 0) throw new Fault('BGEN_PROMPT_CONTRACT_CHANGED', 503);
        compiled.user = compiled.user.slice(0, offset) + compiled.user.slice(offset).replace('ЖАНР: '+compiled.spec.genre, 'ЖАНР: '+genre);
      }
      for (const block of [blocks.HARD_RULES_BLOCK, blocks.OUTPUT_FORMAT_BLOCK, blocks.QUALITY_REMINDER]) {
        if (!block || !system.includes(block)) throw new Fault('BGEN_PROMPT_CONTRACT_CHANGED', 503);
        system = system.replace(block, '');
      }
      const messages = [{ role: 'system', content: system + '\n' + PLATFORM_RULES + '\n' + BRIDGE_RULES }, { role: 'user', content: compiled.user + '\nYAPLIX GameSpec requirements: ' + JSON.stringify(spec) + '\nInclude your own Start/Pause/Restart and touch controls, visible score and win/loss overlay, and the required yaplix_init/event integration. The game must work without external control buttons. The original user request takes precedence over inferred mechanics.\n' + FINAL_CHECKLIST }];
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetch(`${this.url}/api/chat`, {
          method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.model, stream: false, think: false, options: { temperature: 0.2, num_predict: 9000, num_ctx: 16384 }, messages }),
        });
        if (!response.ok) throw new Fault(response.status === 404 ? 'LLM_MODEL_NOT_FOUND' : 'LLM_HTTP', 502);
        const result = JSON.parse(await boundedText(response, MAX_HTML_BYTES * 6 + 8192));
        if (result.done !== true || result.done_reason === 'length' || result.model !== this.model || typeof result.message?.content !== 'string') throw new Fault('LLM_INVALID_RESPONSE', 502);
        const html = extractor.extractGame(result.message.content).html;
        const issues = security.checkSecurity(html).filter(issue => issue.severity === 'error' || issue.id === 'runtime-network');
        const missing = ['yaplix_init','postMessage','protocolVersion','eventId','sessionId','versionId','sequence','game_ready','game_started','score_changed','game_won','game_lost','session_ended'].filter(value => !html.includes(value));
        if (missing.length) issues.push({severity:'error',id:'yaplix-contract',hint:'Include the integration listener/emit function from the system prompt and actually call events in Start, score and win/loss handlers. Missing: '+missing.join(', ')});
        if (html.includes('requestAnimationFrame') && !html.includes('visibilitychange')) issues.push({severity:'error',id:'background-animation',hint:"Add document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); }); using YOUR actual pause function. This handler must cancel the frame and stop gameplay on hidden. Do not resume automatically. Keep a single animation loop during play."});
        if (/\b(?:yaplixEmit|emit)\s*\(\s*['"](?:game_ready|game_started|game_won|game_lost|session_ended)['"]\s*,\s*\{\s*[^}\s]/u.test(html)) issues.push({severity:'error',id:'event-data',hint:'Use EMPTY data for game_ready/game_started/game_won/game_lost/session_ended. Only score_changed carries {score}. Extra fields are rejected by the host.'});
        if (issues.length) {
          if (attempt) throw new Fault('LLM_UNSAFE_ARTIFACT', 502);
          const fixes = issues.map(issue => issue.id + ': ' + issue.hint).join('; ');
          messages.push({ role: 'assistant', content: html }, { role: 'user', content: 'The generated game failed mandatory checks. Correct these issues and preserve actual gameplay and controls. Return the COMPLETE standalone HTML. This is the only repair attempt. Include this integration code and call its events from the real gameplay handlers:\n' + BRIDGE_RULES + '\nREQUIRED FIXES FOR THIS RESPONSE: ' + fixes + '\n' + FINAL_CHECKLIST + '\nUSER REQUIREMENTS THAT MUST REMAIN IMPLEMENTED: ' + spec.prompt });
          continue;
        }
        return parseArtifact({ html, method: 'llm_code', provider: this.provider, model: result.model, generationStatus: 'succeeded', validationStatus: 'unverified' });
      }
      throw new Fault('LLM_UNSAFE_ARTIFACT', 502);
    } catch (e) {
      if (controller.signal.aborted) throw new Fault(signal?.aborted ? 'REQUEST_CANCELLED' : 'LLM_TIMEOUT', signal?.aborted ? 499 : 504);
      if (e instanceof Fault) throw e;
      throw new Fault('LLM_NETWORK_OR_RESPONSE', 502);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); controller.abort(); this.active = undefined; this.busy = false; }
  }
}
// A contract instruction, never a replacement game or an injected client script.
const FINAL_CHECKLIST = "Before returning HTML: declare every game variable (including arrays such as bricks) and initialize all config, state and DOM references BEFORE any init/resize/render call. Check every referenced identifier and initialization order. Give html/body and every canvas ancestor a definite height (100% chain rooted at viewport or 100dvh), never a percentage height against an auto-height parent. Give canvas an explicit CSS width/height, call resize after declarations, set its DPR transform once, and ensure ball/paddle/brick positions fit the logical world. Use pixels-per-second speeds (e.g. ball 260) with dt seconds; keep HUD and Pause/Restart visible during play. Include score_changed with {score}; all lifecycle events use empty data. Include document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); }); adapt pauseGame to YOUR actual pause function which stops gameplay and cancels animation. This literal visibilitychange listener is mandatory for animation. Do not resume automatically. Preserve all requested game mechanics, controls and standalone restart. Return complete HTML only.";
const PLATFORM_RULES = `Generate a complete self-contained HTML5 Canvas game: one <!DOCTYPE html>...</html>, inline CSS and JS, no markdown, placeholders or external dependencies. Start -> actual gameplay -> meaningful win/loss -> restart. Include your OWN accessible buttons and keyboard/pointer/touch controls inside the game; the host provides no gameplay input. Display rules and score. Fit 320px and landscape with controls at least 44px. Use CSS coordinates for gameplay: the canvas backing width/height include DPR, so do not use them as logical world dimensions after ctx.setTransform(dpr,0,0,dpr,0,0). Initialize and resize the logical world correctly, keep ball/paddle/brick bounds inside the visible play area; preserve state on resize. For smooth physics use time delta in seconds with a safe cap. One animation loop only during play; cancel it on pause, end and document.hidden. Draw the initial board before Start. Show win/loss in your own overlay that leaves Restart usable. Do not use native dialogs. Copy the following YAPLIX message listener/emit function and call it from actual gameplay transitions.`;
const BRIDGE_RULES = `YAPLIX integration contract (required): gameplay must also work standalone.
Include meta charset=utf-8 and viewport width=device-width,initial-scale=1,viewport-fit=cover. Fit 320px and landscape; safe-area padding and touch buttons >=44px. Resize Canvas using its actual CSS size and devicePixelRatio without resetting game state. Prefer event-driven drawing; if animating use one requestAnimationFrame loop only during play and pause on document.hidden. Resume safely on visibilitychange. Audio can start only after a real user action. No external assets, libraries or fonts.
Create real playable mechanics matching the request: movement, collisions and meaningful win/loss, not buttons that merely increment a counter. NEVER call alert(), confirm(), prompt(), eval(), new Function(), fetch(), XMLHttpRequest or import/require. Show victory/defeat in your own visible HTML overlay; keep controls usable after restart. No native browser dialogs even at the end of the game.
Use this exact message shape and listener in your generated code:
let yaplixSession=null, yaplixSequence=0, yaplixEnded=false;
function yaplixUuid(){const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);}
function yaplixEmit(type,data={}) {
  if (!yaplixSession || parent===window || yaplixEnded) return;
  parent.postMessage({channel:'yaplix',event:{protocolVersion:1,eventId:yaplixUuid(),sessionId:yaplixSession.sessionId,versionId:yaplixSession.versionId,sequence:yaplixSequence++,type,timestamp:Date.now(),data}},'*');
  if(type==='session_ended') yaplixEnded=true;
}
window.addEventListener('message', e=>{
  if(e.source===parent && e.data?.channel==='yaplix_init' && e.data.protocolVersion===1 && !yaplixSession){yaplixSession=e.data;yaplixEmit('game_ready');}
});
Call yaplixEmit('game_started') on the first Start. Call yaplixEmit('score_changed',{score: numericScore}) when score changes. On victory or defeat call yaplixEmit('game_won') or yaplixEmit('game_lost'), then yaplixEmit('session_ended'). No other event data fields. Never reset the sequence on game restart. After session_ended the platform starts a new session by reloading the iframe; internal restart still works but emits no further events for the ended session. Never send yaplix_init yourself, never read parent DOM or attach listeners to parent, never invent IDs. No events before the real parent init, no fake histories, no HTTP token in the game. Never use fetch, networking or external assets. Buttons must have accessible text and a minimum 44px touch target.`;
export function configuredGenerator(): Generator | undefined {
  const provider = process.env.LIVE_PROVIDER ?? (process.env.BGEN_URL ? 'bgen' : 'none');
  if (provider === 'none') return undefined;
  if (provider === 'ollama') return new LocalCodeAdapter({ url: process.env.OLLAMA_BASE_URL, model: process.env.OLLAMA_MODEL, timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 180_000) });
  if (provider === 'bgen' && process.env.BGEN_URL) return new BGenAdapter({ url: process.env.BGEN_URL, initData: process.env.BGEN_INIT_DATA, timeoutMs: Number(process.env.BGEN_TIMEOUT_MS ?? 30_000) });
  throw new Fault('INVALID_LIVE_PROVIDER');
}
