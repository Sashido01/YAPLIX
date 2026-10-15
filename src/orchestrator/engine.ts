// TASK-013 experimental generation engine (architecture B): derived game spec
// (no extra LLM call), mechanics selection from the library, a single LLM call
// that writes only the new game logic, assembly of the standalone HTML artifact
// from verified primitives plus that logic, then the existing static validator
// and browser checker. The production GenerationEngine (src/live.ts) stays
// untouched; this engine is opt-in for experiment scripts (scripts/orchestrator-*.ts)
// and is not wired into the jobs/UI pipeline.
import { createHash } from 'node:crypto';
import { Fault, parseArtifact, parseSpec } from '../contracts.ts';
import type { Artifact, GenerationAttempt, GameSpec, GameVersion } from '../contracts.ts';
import { CloudOutputFailure, ProviderFailure } from '../transport.ts';
import type { CodeTransport, Generator, GenerationContext, Message, TokenUsage } from '../transport.ts';
import { browserCheck, BrowserFailure, checkerReady } from '../browser-check.ts';
import { eventBridge, extractDocument, validateDocument } from '../generation.ts';
import { orchestratorSpec } from './spec.ts';
import type { OrchestratorGameSpec } from './spec.ts';
import { selectMechanics } from './selector.ts';
import type { SelectionDecision } from './selector.ts';
import { buildHtml, ORCHESTRATOR_SYSTEM_PROMPT } from './html-builder.ts';
import type { BuildTask, PrimitiveRef } from './html-builder.ts';

export class OrchestratorFailure extends Fault {
  readonly attempts: GenerationAttempt[];
  constructor(code: string, attempts: GenerationAttempt[], status = 502) { super(code, status); this.attempts = attempts; }
}

export interface OrchestratorRun {
  version: 13;
  spaceType: OrchestratorGameSpec['spaceType'];
  selection: SelectionDecision['decision'];
  basis: string;
  primitiveKeys: string[];
  primitiveBytes: number;
  llmCodeChars: number;
  llmCodeSha256: string;
  scratchFallback: boolean;
  specPrepMs: number;
  selectMs: number;
  buildMs: number;
  /** TASK-016 mandatory rules carried to the LLM and the visible banner. */
  rules: OrchestratorGameSpec['rules'];
}

export type OrchestratorArtifact = Artifact & { orchestrator: OrchestratorRun };

// Generated logic runs as one inline script body: closing tags or HTML comment
// openers would break the document structure itself.
export function extractLogic(text: string): string {
  let code = text.trim();
  if (code.startsWith('```')) code = code.replace(/^```[a-zA-Z0-9]*\s*\n/, '').replace(/\n?```\s*$/, '').trim();
  if (!code) throw new Fault('LLM_INVALID_RESPONSE', 502);
  if (Buffer.byteLength(code) > 60000) throw new Fault('ARTIFACT_TOO_LARGE', 413);
  if (/<\/\s*(script|html|body)/i.test(code) || /<\!--/.test(code)) throw new Fault('LLM_UNSAFE_ARTIFACT', 502);
  return code;
}

function sha256(text: string): string { return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'); }

const SANDBOX_FATAL = ['BROWSER_SANDBOX_UNAVAILABLE', 'BROWSER_SANDBOX_CONFIGURATION'];
const STOP_COOLDOWN = ['LLM_QUOTA', 'LLM_AUTH', 'LLM_MODEL_NOT_FOUND', 'FREE_MODEL_REQUIRED', 'LLM_CONTEXT_LIMIT', 'LLM_OUTPUT_BUDGET_TOO_SMALL'];

export class OrchestratorEngine implements Generator {
  readonly routes: CodeTransport[];
  private timeout: number;
  private requestTimeout: number;
  private repairs: number;
  private active?: AbortController;
  private check: typeof browserCheck;

  constructor(routes: CodeTransport[], options: { timeoutMs?: number; requestTimeoutMs?: number; repairs?: number; check?: typeof browserCheck } = {}) {
    this.routes = routes;
    this.timeout = options.timeoutMs ?? 180000;
    this.repairs = options.repairs ?? 1;
    this.check = options.check ?? browserCheck;
    if (!routes.length || routes.length > 3 || !Number.isSafeInteger(this.timeout) || this.timeout < 1000 || this.timeout > 300000 || !Number.isSafeInteger(this.repairs) || this.repairs < 0 || this.repairs > 2) throw new Fault('INVALID_LLM_CONFIGURATION');
    this.requestTimeout = options.requestTimeoutMs ?? Math.min(this.timeout, 60000);
    if (!Number.isSafeInteger(this.requestTimeout) || this.requestTimeout < 1000 || this.requestTimeout > this.timeout) throw new Fault('INVALID_LLM_CONFIGURATION');
  }

  close() { this.active?.abort(); }

  async readiness() {
    const state = await this.routes[0].readiness(AbortSignal.timeout(3000));
    return { liveConfigured: true, liveReady: state === 'ready' && checkerReady(), llmState: state === 'ready' && !checkerReady() ? 'browser_missing' : state, provider: this.routes[0].provider, model: this.routes[0].model, browserReady: checkerReady(), fallbackConfigured: this.routes.length > 1 };
  }

  /** Architecture B. Edits are out of scope for the experiment. */
  async generate(spec: GameSpec, previous?: GameVersion, method?: 'llm_code', signal?: AbortSignal, context?: GenerationContext): Promise<Artifact> {
    parseSpec(spec);
    if (method !== undefined && method !== 'llm_code') throw new Fault('INVALID_REQUIRED_METHOD');
    if (previous) throw new Fault('ORCHESTRATOR_NO_EDITS', 400);
    if (this.check === browserCheck && !checkerReady()) throw new Fault('BROWSER_INSTALL_REQUIRED', 503);
    if (this.active) throw new Fault('LLM_BUSY', 409);
    const controller = new AbortController();
    this.active = controller;
    const timer = setTimeout(() => controller.abort(), this.timeout);
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const attempts: GenerationAttempt[] = [];
    const started = performance.now();
    try {
      const specBegan = performance.now();
      const os = orchestratorSpec(spec.prompt, spec);
      const selection = selectMechanics(os);
      const specPrepMs = Math.round(performance.now() - specBegan);
      const selectMs = Math.round(performance.now() - specBegan) - specPrepMs;
      // TASK-016 mandatory rules: verbatim user conditions first; a documented
      // default completion objective only when the prompt states none.
      const rules = os.rules;
      const rulesBanner = 'Goal: ' + (rules.objective ?? 'complete the stated game goal')
        + ' | Lose: ' + (rules.loss ?? 'declared failure condition')
        + ' | Win: ' + (rules.win ?? 'reach the goal') + ' | Controls: keyboard + on-screen buttons';
      const rulesBlock = JSON.stringify(rules);
      const scratch = selection.decision === 'scratch';
      let basis: string = 'scratch';
      let primitiveKeys: string[] = [];
      let primitiveBytes = 0;
      let chosen: PrimitiveRef[] = [];
      let messages: Message[];
      if (scratch) {
        messages = [
          { role: 'system', content: 'You write original playable browser games for YAPLIX. Return one complete HTML document, beginning <!DOCTYPE html>, containing inline CSS/JavaScript and ending </html>. Invent mechanics from the user\'s description; no fixed genre catalog or template selector. Include a title, visible rules, score, understandable win/loss and restart. Canvas 2D is required. No downloads, networking, imports, eval, dialogs, workers or external resources. Include <meta name="viewport" content="width=device-width,initial-scale=1">. The game must fit a 320px phone and landscape. Size canvas ancestors explicitly. Initialize all state before calling setup or draw. Animate only while playing using one requestAnimationFrame loop with capped dt. Pause when hidden; resume retains score, world and timing without starting another loop. Movement and collision must visibly follow real keyboard and pointer/touch input. Keep the HTML concise, below 400 lines; output code without analysis.\nUse this event v1 bridge exactly:\n' + eventBridge + '\nInitial setup and score reset MUST NOT send score_changed. In the first real Start handler report game_started BEFORE any initialization that can send events, report score_changed on real changes, one real terminal result game_won/game_lost then session_ended, and stay silent on internal restart after session_ended. Mark exactly one Start data-yaplix-start, one Pause/resume data-yaplix-pause, a Restart data-yaplix-restart and a gameplay control or canvas data-yaplix-input; all buttons min-height:44px, start/input inside the 320px viewport; never auto-start. Expose a read-only <output data-yaplix-state> with concise JSON {phase,score,genreState} after real updates.' },
          { role: 'user', content: 'User request: ' + spec.prompt + '\nAudience: ' + spec.audience + '\nControls: ' + spec.controls.join(', ') },
        ];
      } else {
        const librarySelection = selection as { decision: 'use-library'; basis: string; chosen: PrimitiveRef[] };
        basis = librarySelection.basis;
        chosen = librarySelection.chosen;
        primitiveKeys = chosen.map(p => p.key);
        primitiveBytes = chosen.reduce((sum, p) => sum + p.bytes, 0);
        const apiList = chosen.map(p => p.key + ': ' + p.api).join('\n');
        messages = [
          { role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT },
          { role: 'user', content: 'Game task for the YAPLIX orchestrator.\nUser request (verbatim, authoritative - any rule it states wins):\n' + spec.prompt + '\nDerived spec (heuristic hints; never contradict the verbatim request):\n' + JSON.stringify({ space: os.spaceType, entities: os.entities, movement: os.movement, interactions: os.interactions, winRule: os.winRule, lossRule: os.lossRule }) + '\nMANDATORY RULES to implement exactly as executable state checks (win and loss must both be reachable; if the request seems endless, rules.win is the declared completion result):\n' + rulesBlock + '\nChosen primitives:\n' + apiList + '\nWrite the complete game-logic JavaScript now.' },
        ];
      }
      let lastCode = 'LLM_GENERATION_FAILED';
      for (const route of this.routes) {
        const key = route.provider + '/' + route.model;
        if (context?.blockedRoutes?.includes(key)) { lastCode = 'LLM_ROUTES_UNAVAILABLE'; continue; }
        for (let repair = 0; repair <= this.repairs; repair++) {
          if (context && attempts.length >= (context.maxCalls ?? 6)) throw new OrchestratorFailure(attempts.at(-1)?.errorCode ?? 'JOB_ATTEMPT_LIMIT', attempts, 409);
          const begin = performance.now();
          let actual: string | null = null;
          let raw = '';
          let requestMs = 0;
          let validationMs = 0;
          let tokens: TokenUsage = {};
          let logic = '';
          const requestController = new AbortController();
          const requestTimer = setTimeout(() => requestController.abort(), this.requestTimeout);
          const requestSignal = AbortSignal.any([controller.signal, requestController.signal]);
          try {
            context?.stage(repair ? 'repairing' : 'generating');
            if (!route.observesDispatch) context?.dispatch(route);
            const transportContext = context ? { ...context, partial: (value: string, model: string | null, usage?: TokenUsage) => { if (value) raw = value; if (model) actual = model; if (usage) tokens = { ...tokens, ...usage }; context.partial(value, model, usage); } } : undefined;
            const response = await route.complete(messages, requestSignal, transportContext);
            clearTimeout(requestTimer);
            requestMs = Math.round(performance.now() - begin);
            actual = response.model;
            tokens = { ...(response.outputTokens === undefined ? {} : { outputTokens: response.outputTokens }), ...(response.reasoningTokens === undefined ? {} : { reasoningTokens: response.reasoningTokens }) };
            raw = response.code;
            context?.stage('validating');
            const buildBegan = performance.now();
            let html: string;
            if (!scratch) {
              logic = extractLogic(raw);
              const task: BuildTask = {
                title: spec.prompt.replace(/\s+/g, ' ').trim().slice(0, 60) || 'YAPLIX game',
                rules: spec.prompt.slice(0, 400),
                derivation: JSON.stringify({ space: os.spaceType, entities: os.entities, movement: os.movement, interactions: os.interactions, win: os.winRule, loss: os.lossRule, primitives: primitiveKeys }),
                chosen,
                code: logic,
                rulesBanner,
              };
              html = buildHtml(task);
            } else {
              // Novel mechanics fall back to the proven full-document path.
              html = extractDocument(raw);
              logic = html;
            }
            const issues = validateDocument(html);
            if (issues.length) throw new Fault('LLM_UNSAFE_ARTIFACT', 502);
            const buildMs = Math.round(performance.now() - buildBegan);
            const artifactBytes = Buffer.byteLength(html);
            if (artifactBytes > 200000) throw new Fault('ARTIFACT_TOO_LARGE', 413);
            const checkBegan = performance.now();
            const evidence = await this.check(html, controller.signal);
            validationMs = Math.round(performance.now() - checkBegan);
            if (controller.signal.aborted) throw new Fault('REQUEST_CANCELLED', 499);
            attempts.push({ route: route.route, provider: route.provider, requestedModel: route.model, model: actual, outcome: 'accepted', errorCode: null, elapsedMs: Math.round(performance.now() - begin), requestMs, validationMs, ...tokens });
            context?.attempt(attempts.at(-1)!);
            const base = parseArtifact({ html, method: 'llm_code', provider: route.provider, model: actual, generationStatus: 'succeeded', validationStatus: 'passed', generation: { attempts, fallback: route !== this.routes[0], elapsedMs: Math.round(performance.now() - started), browser: evidence } });
            // Attached after parseArtifact: the artifact contract itself rejects
            // unknown keys, so orchestrator provenance travels beside it.
            const run: OrchestratorRun = { version: 13, spaceType: os.spaceType, selection: selection.decision, basis, primitiveKeys, primitiveBytes, llmCodeChars: logic.length, llmCodeSha256: sha256(logic), scratchFallback: scratch, specPrepMs, selectMs, buildMs, rules };
            const result: OrchestratorArtifact = { ...base, orchestrator: run };
            return result;
          } catch (error) {
            if (controller.signal.aborted) {
              attempts.push({ route: route.route, provider: route.provider, requestedModel: route.model, model: actual, outcome: 'failed', errorCode: signal?.aborted ? 'REQUEST_CANCELLED' : 'LLM_TIMEOUT', elapsedMs: Math.round(performance.now() - begin), requestMs: requestMs || Math.round(performance.now() - begin), validationMs, ...tokens });
              context?.attempt(attempts.at(-1)!);
              throw error;
            }
            if (error instanceof ProviderFailure) { actual = error.actualModel; raw = error.partial || raw; tokens = error.usage; if (raw) context?.partial(raw, actual, tokens); if (error.retryAt) context?.retryAt?.(error.retryAt); }
            lastCode = requestController.signal.aborted ? 'LLM_TIMEOUT' : error instanceof Fault ? error.code : 'LLM_NETWORK_OR_RESPONSE';
            const feedback = error instanceof BrowserFailure ? error.feedback : error instanceof CloudOutputFailure ? 'The output token budget was exhausted. Return concise complete game logic with no commentary.' : '';
            attempts.push({ route: route.route, provider: route.provider, requestedModel: route.model, model: actual ?? null, outcome: actual ? 'rejected' : 'failed', errorCode: lastCode, elapsedMs: Math.round(performance.now() - begin), requestMs: requestMs || Math.round(performance.now() - begin), validationMs, ...tokens });
            context?.attempt(attempts.at(-1)!);
            if (context && ['RATE_LIMIT', 'JOB_ATTEMPT_LIMIT'].includes(lastCode)) throw new OrchestratorFailure(lastCode, attempts, 429);
            if (context && STOP_COOLDOWN.includes(lastCode)) { context.cooldownRoute?.(route, Date.now() + 900000, lastCode); context.blockRoute?.(route, lastCode); break; }
            if (context && lastCode === 'LLM_RATE_LIMIT') {
              const until = error instanceof ProviderFailure && error.retryAt ? error.retryAt : Date.now() + 60000;
              context.cooldownRoute?.(route, until, lastCode);
              context.retryAt?.(until);
              break;
            }
            if (context && ['LLM_TIMEOUT', 'LLM_CONNECTION_INTERRUPTED', 'LLM_STREAM_ERROR'].includes(lastCode)) {
              // Unknown remote billing must not cause unconditional duplicate
              // requests; a separate explicitly configured route can recover.
              if (route.provider !== 'openrouter' && route.provider !== 'ollama') context.blockRoute?.(route, lastCode);
              break;
            }
            if (SANDBOX_FATAL.includes(lastCode)) throw new OrchestratorFailure(lastCode, attempts, 503);
            if (!actual || repair === this.repairs || lastCode === 'BROWSER_INSTALL_REQUIRED') break;
            messages.push(
              { role: 'assistant', content: raw || '(empty response)' },
              { role: 'user', content: (scratch
                ? 'Browser/static verification rejected the document: ' + lastCode + '. ' + feedback + ' Return one complete fresh HTML document implementing the original request. Preserve working mechanics. Do not start automatically, do not duplicate lifecycle events. Original request: ' + JSON.stringify(spec)
                : 'Verification rejected this game code: ' + lastCode + '. ' + feedback + ' Preserve every working mechanic, fix the defect and return the FULL corrected game-logic JavaScript only (same required structure, no HTML, no commentary). Original request: ' + JSON.stringify(spec)) });
          } finally { clearTimeout(requestTimer); }
        }
      }
      throw new OrchestratorFailure(lastCode, attempts);
    } catch (error) {
      if (controller.signal.aborted) throw new OrchestratorFailure(signal?.aborted ? 'REQUEST_CANCELLED' : 'LLM_TIMEOUT', attempts, signal?.aborted ? 499 : 504);
      if (error instanceof OrchestratorFailure) throw error;
      throw new OrchestratorFailure(error instanceof Fault ? error.code : 'LLM_NETWORK_OR_RESPONSE', attempts);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); controller.abort(); this.active = undefined; }
  }
}
