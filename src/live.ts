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
interface Compiler { compile(input: { prompt: string; audience: string }, options: { previousCode?: string; previousPrompt?: string }): { system: string; user: string } }
interface Extractor { extractGame(text: string): { html: string } }
interface Security { checkSecurity(html: string): { severity: string; id: string }[] }
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
  return { compiler, extractor, security };
}
export class LocalCodeAdapter implements Generator {
  readonly provider = 'ollama';
  readonly url: string;
  readonly model: string;
  private timeout: number;
  private busy = false;
  constructor(options: { url?: string; model?: string; timeoutMs?: number } = {}) {
    let url: URL;
    try { url = new URL(options.url ?? 'http://127.0.0.1:11434'); } catch { throw new Fault('INVALID_LLM_URL'); }
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Fault('INSECURE_LLM_URL');
    this.url = url.origin; this.model = options.model ?? 'qwen2.5-coder:14b'; this.timeout = options.timeoutMs ?? 180_000;
    if (!this.model.trim() || this.model.length > 128 || !Number.isSafeInteger(this.timeout) || this.timeout < 1 || this.timeout > 300_000) throw new Fault('INVALID_LLM_CONFIGURATION');
  }
  async generate(spec: GameSpec, previous?: GameVersion, requiredMethod?: 'llm_code'): Promise<Artifact> {
    parseSpec(spec);
    if (requiredMethod !== undefined && requiredMethod !== 'llm_code') throw new Fault('INVALID_REQUIRED_METHOD');
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Fault('INSECURE_TLS_CONFIGURATION', 503);
    if (this.busy) throw new Fault('LLM_BUSY', 409);
    this.busy = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const { compiler, extractor, security } = await modules();
      const compiled = compiler.compile({ prompt: spec.prompt, audience: spec.audience }, previous ? { previousCode: previous.html, previousPrompt: previous.spec.prompt } : {});
      const response = await fetch(`${this.url}/api/chat`, {
        method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, stream: false, think: false, options: { temperature: 0.2, num_predict: 9000, num_ctx: 16384 }, messages: [{ role: 'system', content: compiled.system + '\n' + BRIDGE_RULES }, { role: 'user', content: compiled.user + '\nYAPLIX GameSpec requirements: ' + JSON.stringify(spec) }] }),
      });
      if (!response.ok) throw new Fault(response.status === 404 ? 'LLM_MODEL_NOT_FOUND' : 'LLM_HTTP', 502);
      const result = JSON.parse(await boundedText(response, MAX_HTML_BYTES * 6 + 8192));
      if (result.done !== true || result.done_reason === 'length' || result.model !== this.model || typeof result.message?.content !== 'string') throw new Fault('LLM_INVALID_RESPONSE', 502);
      const html = extractor.extractGame(result.message.content).html;
      if (security.checkSecurity(html).some(issue => issue.severity === 'error' || issue.id === 'runtime-network')) throw new Fault('LLM_UNSAFE_ARTIFACT', 502);
      return parseArtifact({ html, method: 'llm_code', provider: this.provider, model: result.model, generationStatus: 'succeeded', validationStatus: 'unverified' });
    } catch (e) {
      if (controller.signal.aborted) throw new Fault('LLM_TIMEOUT', 504);
      if (e instanceof Fault) throw e;
      throw new Fault('LLM_NETWORK_OR_RESPONSE', 502);
    } finally { clearTimeout(timer); controller.abort(); this.busy = false; }
  }
}
// A contract instruction, never a replacement game or an injected client script.
const BRIDGE_RULES = `YAPLIX integration contract (required): gameplay must also work standalone.
Use this exact message shape and listener in your generated code:
let yaplixSession=null, yaplixSequence=0, yaplixEnded=false;
function yaplixEmit(type,data={}) {
  if (!yaplixSession || parent===window || yaplixEnded) return;
  parent.postMessage({channel:'yaplix',event:{protocolVersion:1,eventId:crypto.randomUUID(),sessionId:yaplixSession.sessionId,versionId:yaplixSession.versionId,sequence:yaplixSequence++,type,timestamp:Date.now(),data}},'*');
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
