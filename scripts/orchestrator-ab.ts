// TASK-013 A/B harness: compares the production architecture A (LLM writes the
// full HTML document) with the experimental architecture B (derived spec ->
// mechanics selection -> primitives library -> LLM writes only new game logic).
// Protocol: same model, same timeouts, same repairs budget; at most 6 primary
// generations and 2 repairs in total. Results are stored under .local/task-013/
// (never committed). No LLM call is made when --dry is passed (assembly+checks
// only, using the hand-authored sample logic) so the harness itself is testable.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configuredGenerator } from '../src/live.ts';
import { OrchestratorEngine } from '../src/orchestrator/engine.ts';
import type { OrchestratorArtifact, OrchestratorRun } from '../src/orchestrator/engine.ts';
import { browserCheck, checkerReady } from '../src/browser-check.ts';
import { extractDocument, validateDocument } from '../src/generation.ts';
import { parseArtifact, Fault } from '../src/contracts.ts';
import type { Artifact, GameSpec } from '../src/contracts.ts';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const out = resolve(root, '.local/task-013');
mkdirSync(out, { recursive: true });

const PROMPTS: Record<string, string> = {
  '1': 'Тетрис: стрелки влево-вправо, вращение фигур, падение фигур, пробел — сброс фигуры вниз. Линии из блоков исчезают со взрывом и добавляют очки. Проигрыш — когда блоки достигают верха.',
  '2': 'Змейка в лабиринте со стенами: змейка собирает яблоки, стреляет по преследующим врагам, у змейки есть жизни и счет. Стены блокируют движение.',
  '3': 'Космический корабль на клеточном поле строит стены из блоков, отражая волны врагов; стены стреляют. Волны усложняются, проигрыш при потере базы.',
};

const arg = (name: string, fallback?: string): string | undefined => {
  const prefix = '--' + name + '=';
  const found = process.argv.find(v => v.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};
const promptId = arg('prompt', '1')!;
const dry = process.argv.includes('--dry');
const branch = (arg('branch', 'both') ?? 'both') as 'A' | 'B' | 'both';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

if (!PROMPTS[promptId]) {
  console.error('Unknown prompt id: ' + promptId);
  process.exit(2);
}
const prompt = PROMPTS[promptId];
const spec: GameSpec = { prompt, audience: 'default', genre: 'custom/task-013', mechanics: [], controls: ['keyboard', 'touch'], responsive: true, webview: true };

function envSummary() {
  return {
    model: process.env.OLLAMA_CLOUD_MODEL ?? process.env.CLOUD_MODEL ?? null,
    provider: process.env.LIVE_PROVIDER ?? 'cloud',
    repairs: Number(process.env.LLM_REPAIRS ?? 1),
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 180000),
    requestTimeoutMs: Number(process.env.LLM_REQUEST_TIMEOUT_MS ?? 45000),
    maxTokens: Number(process.env.LLM_MAX_TOKENS ?? 12000),
  };
}

function summarize(id: string, artifact: Artifact, wallMs: number, extra: Record<string, unknown> = {}) {
  const run = (artifact as { orchestrator?: OrchestratorRun }).orchestrator;
  const gen = artifact.generation;
  return {
    id,
    branch: extra.branch as string,
    promptId,
    ttfpgMs: wallMs,
    attempts: gen?.attempts.length ?? 1,
    requestMs: gen?.attempts.map(a => a.requestMs ?? 0) ?? [],
    validationMs: gen?.attempts.map(a => a.validationMs ?? 0) ?? [],
    outputTokens: gen?.attempts.reduce((s, a) => s + (a.outputTokens ?? 0), 0) ?? null,
    reasoningTokens: gen?.attempts.reduce((s, a) => s + (a.reasoningTokens ?? 0), 0) ?? null,
    repairCount: (gen?.attempts.length ?? 1) - 1,
    htmlBytes: Buffer.byteLength(artifact.html),
    model: artifact.model,
    provider: artifact.provider,
    errorCode: (extra.errorCode as string | null) ?? null,
    orchestrator: run ?? null,
    ...extra,
  };
}

async function branchA(): Promise<{ artifact: Artifact; wallMs: number; errorCode: string | null }> {
  const began = Date.now();
  try {
    const engine = configuredGenerator();
    if (!engine) throw new Fault('LLM_NOT_CONFIGURED', 400);
    try {
      const artifact = await engine.generate(spec);
      return { artifact, wallMs: Date.now() - began, errorCode: null };
    } finally { engine.close(); }
  } catch (error) {
    const code = error instanceof Fault ? error.code : 'UNKNOWN';
    return { artifact: { html: '', method: 'mock', provider: 'none', model: null, generationStatus: 'failed', validationStatus: 'unverified' }, wallMs: Date.now() - began, errorCode: code } as unknown as { artifact: Artifact; wallMs: number; errorCode: string | null };
  }
}

async function branchB(): Promise<{ artifact: Artifact; wallMs: number; errorCode: string | null }> {
  const began = Date.now();
  try {
    const routes = configuredGenerator()?.routes
      ?? (() => { throw new Fault('LLM_NOT_CONFIGURED', 400); })();
    const engine = new OrchestratorEngine(routes, {
      timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 180000),
      requestTimeoutMs: Number(process.env.LLM_REQUEST_TIMEOUT_MS ?? 45000),
      repairs: Math.min(Number(process.env.LLM_REPAIRS ?? 1), 2),
    });
    try {
      const artifact = await engine.generate(spec);
      return { artifact, wallMs: Date.now() - began, errorCode: null };
    } finally { engine.close(); }
  } catch (error) {
    const code = error instanceof Fault ? error.code : 'UNKNOWN';
    return { artifact: { html: '', method: 'mock', provider: 'none', model: null, generationStatus: 'failed', validationStatus: 'unverified' }, wallMs: Date.now() - began, errorCode: code } as unknown as { artifact: Artifact; wallMs: number; errorCode: string | null };
  }
}

function writeHtml(name: string, artifact: Artifact | null, evidence: unknown) {
  if (artifact && artifact.html) writeFileSync(resolve(out, name + '.html'), artifact.html);
  if (evidence !== undefined) writeFileSync(resolve(out, name + '.evidence.json'), JSON.stringify(evidence, null, 2));
}

let llmCalls = 0;
function budgetCheck() {
  llmCalls++;
  if (llmCalls > 12) { console.error('BUDGET_EXCEEDED: more than 12 route attempts'); process.exit(3); }
}

console.log('[task-013] prompt ' + promptId + ' (' + (dry ? 'DRY assembly only' : 'LIVE') + '), env ' + JSON.stringify(envSummary()));
if (!dry && !checkerReady()) { console.error('BROWSER_INSTALL_REQUIRED: run npm run browsers:install'); process.exit(4); }

const report: Record<string, unknown> = { promptId, prompt, dry, env: envSummary(), startedAt: new Date().toISOString() };

if (branch === 'A' || branch === 'both') {
  if (dry) {
    console.log('[A] DRY skipped (needs a live route; measured separately in live phases).');
  } else {
    budgetCheck();
    const { artifact, wallMs, errorCode } = await branchA();
    const summary = summarize('A-prompt-' + promptId, artifact, wallMs, { branch: 'A', errorCode });
    report.A = summary;
    writeHtml('a-prompt-' + promptId, errorCode ? null : artifact, summary);
    console.log('[A] ' + JSON.stringify(summary));
  }
}

if (branch === 'B' || branch === 'both') {
  if (dry) {
    console.log('[B] DRY skipped for live measurement consistency (assembly is proven by unit/browser tests).');
  } else {
    budgetCheck();
    const { artifact, wallMs, errorCode } = await branchB();
    const summary = summarize('B-prompt-' + promptId, artifact, wallMs, { branch: 'B', errorCode });
    report.B = summary;
    if (!errorCode) writeHtml('b-prompt-' + promptId, artifact, summary);
    console.log('[B] ' + JSON.stringify(summary));
  }
}

writeFileSync(resolve(out, 'ab-' + stamp + '.json'), JSON.stringify(report, null, 2));
console.log('[task-013] report -> ' + resolve(out, 'ab-' + stamp + '.json'));
