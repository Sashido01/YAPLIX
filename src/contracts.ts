// Pure validators shared by the API and the browser bridge. No Node dependencies.
import type { EvidenceLevel, ValidationAspect } from './validation.ts';
import {validBrowserProfiles,type BrowserScope} from './browser-profiles.ts';
import {LIVE_JOB_TIMEOUT_MS} from './generation-limits.ts';
export interface BrowserChecks { checks?:{aspect:ValidationAspect;level:EvidenceLevel}[]; elapsedMs?:number }
// Historical full-html evidence predates landscape. Preserve its exact profiles;
// the current checker emits 320/390/844, while startup-input-pause uses 320/390.
export interface RenderingEvidence {contract:'canvas-webgl-v1'|'canvas-webgl-strict-v2';contexts:('2d'|'webgl'|'webgl2')[];profiles:number[]}
export interface BrowserEvidence extends BrowserChecks { profiles:number[]; offline:true; errors:0; scope:BrowserScope; levels?:string[];rendering?:RenderingEvidence }
export const MAX_HTML_BYTES = 200_000;
export const MAX_EVENT_BYTES = 4096;
export const MAX_EDIT_PROMPT_CHARS = 1200;
export const methods = ['llm_code', 'template_config', 'mock', 'fallback','authored'] as const;
export const eventTypes = ['game_ready', 'game_started', 'score_changed', 'result_changed', 'game_won', 'game_lost', 'session_ended', 'game_error'] as const;
export type GenerationMethod = typeof methods[number];
export type EventType = typeof eventTypes[number];
export interface GameSpec {
  prompt: string;
  audience: 'default' | 'kids' | 'elderly' | 'hardcore';
  genre: string;
  mechanics: string[];
  controls: ('keyboard' | 'touch' | 'pointer')[];
  responsive: boolean;
  webview: boolean;
}
export interface Artifact {
  html: string;
  method: GenerationMethod;
  provider: string | null;
  model: string | null;
  generationStatus: 'succeeded' | 'failed';
  validationStatus: 'unverified' | 'passed' | 'failed';
  generation?: { attempts: GenerationAttempt[]; fallback: boolean; elapsedMs: number; browser: BrowserEvidence };
}
export interface GenerationAttempt { route: 'primary' | 'secondary' | 'local'; provider: string; requestedModel: string; model: string | null; outcome: 'accepted' | 'rejected' | 'failed'; errorCode: string | null; elapsedMs: number; requestMs?:number;validationMs?:number;outputTokens?:number;reasoningTokens?:number }
export interface GameVersion extends Artifact {
  gameId: string;
  versionId: string;
  previousVersionId: string | null;
  spec: GameSpec;
  sha256: string;
  createdAt: string;
}
export interface GameEvent {
  protocolVersion: 1;
  eventId: string;
  sessionId: string;
  versionId: string;
  sequence: number;
  type: EventType;
  timestamp: number;
  data: { score?: number; value?:number; message?: string };
}
export class Fault extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) { super(code); this.code = code; this.status = status; }
}
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Fault('INVALID_OBJECT');
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).some(k => !keys.includes(k))) throw new Fault('UNKNOWN_FIELD');
  return obj;
}
function string(value: unknown, max: number, min = 1): string {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Fault('INVALID_STRING');
  return value;
}
function choice<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Fault('INVALID_ENUM');
  return value as T;
}
export function uuid(value: unknown): string {
  const text = string(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new Fault('INVALID_ID');
  return text.toLowerCase();
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 12) throw new Fault('INVALID_ARRAY');
  return value.map(v => string(v, 64));
}
export function parseSpec(value: unknown, maxPromptChars = 500): GameSpec {
  const o = object(value, ['prompt', 'audience', 'genre', 'mechanics', 'controls', 'responsive', 'webview']);
  if (typeof o.responsive !== 'boolean' || typeof o.webview !== 'boolean') throw new Fault('INVALID_BOOLEAN');
  const controls = strings(o.controls).map(v => choice(v, ['keyboard', 'touch', 'pointer'] as const));
  if (!controls.length) throw new Fault('CONTROLS_REQUIRED');
  return { prompt: string(o.prompt, maxPromptChars, 2), audience: choice(o.audience, ['default', 'kids', 'elderly', 'hardcore'] as const), genre: string(o.genre, 64), mechanics: strings(o.mechanics), controls, responsive: o.responsive, webview: o.webview };
}
export function parseArtifact(value: unknown, source:'generation'|'saved-metadata'='generation'): Artifact {
  const o = object(value, ['html', 'method', 'provider', 'model', 'generationStatus', 'validationStatus','generation']);
  const html = string(o.html, MAX_HTML_BYTES);
  if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) throw new Fault('ARTIFACT_TOO_LARGE', 413);
  if (!/^\s*<!doctype html>/i.test(html) || !/<html[\s>]/i.test(html) || !/<\/html>\s*$/i.test(html)) throw new Fault('INVALID_HTML');
  // Structure only; this does not establish playability or sanitize game code.
  const artifact:Artifact={ html, method: choice(o.method, methods), provider: o.provider === null ? null : string(o.provider, 128), model: o.model === null ? null : string(o.model, 128), generationStatus: choice(o.generationStatus, ['succeeded', 'failed'] as const), validationStatus: choice(o.validationStatus, ['unverified', 'passed', 'failed'] as const) };
  if(source==='generation'&&artifact.method==='llm_code'&&artifact.validationStatus==='passed'&&o.generation===undefined)throw new Fault('INVALID_GENERATION_METADATA');
  if(o.generation!==undefined){
    const g=object(o.generation,['attempts','fallback','elapsedMs','browser']);
    // Persist the full supported job duration; dispatch deadlines remain independently enforced.
    const timing=(v:unknown)=>{if(!Number.isSafeInteger(v)||(v as number)<0||(v as number)>LIVE_JOB_TIMEOUT_MS)throw new Fault('INVALID_GENERATION_METADATA');return v as number;};
    if(!Array.isArray(g.attempts)||!g.attempts.length||g.attempts.length>9||typeof g.fallback!=='boolean')throw new Fault('INVALID_GENERATION_METADATA');
    const attempts=g.attempts.map(v=>{const a=object(v,['route','provider','requestedModel','model','outcome','errorCode','elapsedMs','requestMs','validationMs','outputTokens','reasoningTokens']);const tokens:Partial<GenerationAttempt>={};for(const name of ['requestMs','validationMs'] as const){if(a[name]!==undefined)tokens[name]=timing(a[name]);}for(const name of ['outputTokens','reasoningTokens'] as const){if(a[name]!==undefined){if(!Number.isSafeInteger(a[name])||(a[name] as number)<0||(a[name] as number)>1000000)throw new Fault('INVALID_GENERATION_METADATA');tokens[name]=a[name] as number;}}return{route:choice(a.route,['primary','secondary','local'] as const),provider:string(a.provider,128),requestedModel:string(a.requestedModel,128),model:a.model===null?null:string(a.model,128),outcome:choice(a.outcome,['accepted','rejected','failed'] as const),errorCode:a.errorCode===null?null:string(a.errorCode,128),elapsedMs:timing(a.elapsedMs),...tokens};});
    const b=object(g.browser,['profiles','offline','errors','scope','levels','checks','elapsedMs','rendering']);
    const levels=['HTML_VALID','JS_EXECUTABLE','UI_VISIBLE','MOBILE_VERIFIED'];if(b.levels!==undefined&&JSON.stringify(b.levels)!==JSON.stringify(levels))throw new Fault('INVALID_GENERATION_METADATA');
    const profiles=b.profiles;
    const validProfiles=validBrowserProfiles(profiles,b.scope,source==='saved-metadata');
    if(!validProfiles||b.offline!==true||b.errors!==0||(b.scope!=='startup-input-pause'&&b.scope!=='full-html')||artifact.method!=='llm_code'||artifact.validationStatus!=='passed')throw new Fault('INVALID_GENERATION_METADATA');
    const final=attempts.at(-1)!;if(final.outcome!=='accepted'||final.errorCode!==null||final.provider!==artifact.provider||final.model!==artifact.model)throw new Fault('INVALID_GENERATION_METADATA');
    const extended:BrowserChecks={};
    if(b.elapsedMs!==undefined)extended.elapsedMs=timing(b.elapsedMs);
    if(b.checks!==undefined){
      const aspects=['html-runs','input-works','gameplay-observed','win-reachable','loss-reachable','restart-works'] as const;
      if(!Array.isArray(b.checks)||b.checks.length!==aspects.length)throw new Fault('INVALID_GENERATION_METADATA');
      extended.checks=b.checks.map((value,i)=>{const c=object(value,['aspect','level']);if(c.aspect!==aspects[i])throw new Fault('INVALID_GENERATION_METADATA');const level=choice(c.level,['VERIFIED','FAILED','NOT_VERIFIED'] as const);if(level==='FAILED')throw new Fault('INVALID_GENERATION_METADATA');return{aspect:aspects[i],level};});
    }
    let rendering:RenderingEvidence|undefined;
    if(source==='generation'&&b.rendering===undefined)throw new Fault('INVALID_GENERATION_METADATA');
    if(b.rendering!==undefined){
      const r=object(b.rendering,['contract','contexts','profiles']);
      if(!['canvas-webgl-v1','canvas-webgl-strict-v2'].includes(r.contract as string)||source==='generation'&&r.contract!=='canvas-webgl-strict-v2'||!Array.isArray(r.contexts)||!r.contexts.length||r.contexts.length>3||new Set(r.contexts).size!==r.contexts.length||r.contexts.some(c=>!['2d','webgl','webgl2'].includes(c))||!validBrowserProfiles(r.profiles,'full-html',false))throw new Fault('INVALID_GENERATION_METADATA');
      rendering={contract:r.contract as RenderingEvidence['contract'],contexts:[...r.contexts],profiles:[...r.profiles as number[]]};
    }
    artifact.generation={attempts,fallback:g.fallback,elapsedMs:timing(g.elapsedMs),browser:{profiles:[...profiles as number[]],offline:true,errors:0,scope:b.scope,...(b.levels?{levels}:{}),...extended,...(rendering?{rendering}:{})}};
  }
  return artifact;
}
export function parseEvent(value: unknown): GameEvent {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_EVENT_BYTES) throw new Fault('EVENT_TOO_LARGE', 413);
  const o = object(value, ['protocolVersion', 'eventId', 'sessionId', 'versionId', 'sequence', 'type', 'timestamp', 'data']);
  if (o.protocolVersion !== 1) throw new Fault('PROTOCOL_MISMATCH');
  if (!Number.isSafeInteger(o.sequence) || (o.sequence as number) < 0 || (o.sequence as number) >= 1000) throw new Fault('INVALID_SEQUENCE');
  if (!Number.isSafeInteger(o.timestamp) || (o.timestamp as number) < 0) throw new Fault('INVALID_TIMESTAMP');
  const type = choice(o.type, eventTypes);
  const data = object(o.data, type === 'score_changed' ? ['score'] : type==='result_changed'?['value']:type === 'game_error' ? ['message'] : []);
  if(type==='result_changed'&&(!Number.isSafeInteger(data.value)||(data.value as number)<0||(data.value as number)>1e9))throw new Fault('INVALID_RESULT');
  if (type === 'score_changed' && (typeof data.score !== 'number' || !Number.isFinite(data.score) || Math.abs(data.score) > 1e9)) throw new Fault('INVALID_SCORE');
  if (type === 'game_error') string(data.message, 512);
  return { protocolVersion: 1, eventId: uuid(o.eventId), sessionId: uuid(o.sessionId), versionId: uuid(o.versionId), sequence: o.sequence as number, type, timestamp: o.timestamp as number, data: type === 'score_changed' ? { score: data.score as number } : type==='result_changed'?{value:data.value as number}:type === 'game_error' ? { message: data.message as string } : {} };
}
