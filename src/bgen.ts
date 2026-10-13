import { Fault, MAX_HTML_BYTES, object, parseArtifact, parseSpec } from './contracts.ts';
import type { Artifact, GameSpec, GameVersion } from './contracts.ts';
import { createHash } from 'node:crypto';

export interface LiveCapabilities {
  protocolVersion: 1; revision: string; codeGeneration: true;
  tlsVerification: true; previousCode: boolean;
}
export function requiredMethod(value: unknown): 'llm_code' | undefined {
  if (value === undefined) return undefined;
  if (value !== 'llm_code') throw new Fault('INVALID_REQUIRED_METHOD');
  return value;
}

export async function boundedText(response: Response, max: number): Promise<string> {
  if (Number(response.headers.get('content-length')) > max) {
    await response.body?.cancel().catch(() => {});
    throw new Fault('BODY_TOO_LARGE', 413);
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new Fault('BODY_TOO_LARGE', 413);
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export interface BGenOptions { url: string; timeoutMs?: number; initData?: string }
export interface Generator { generate(spec: GameSpec, previous?: GameVersion, requestedMethod?: 'llm_code', signal?: AbortSignal): Promise<Artifact>; close?(): void }
function upstreamArtifact(value: unknown): Artifact {
  try { return parseArtifact(value); }
  catch { throw new Fault('BGEN_INVALID_ARTIFACT', 502); }
}
export class BGenAdapter {
  private options: BGenOptions;
  private active = new Set<AbortController>();
  close() { for (const controller of this.active) controller.abort(); }
  constructor(options: BGenOptions) {
    let url: URL;
    try { url = new URL(options.url); }
    catch { throw new Fault('INVALID_BGEN_URL'); }
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Fault('INVALID_BGEN_URL');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Fault('INSECURE_BGEN_URL');
    if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 120_000)) throw new Fault('INVALID_TIMEOUT');
    this.options = options;
  }
  async liveCapabilities(signal?: AbortSignal): Promise<LiveCapabilities> {
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Fault('INSECURE_TLS_CONFIGURATION', 503);
    const controller = new AbortController(), cancel = () => controller.abort();
    this.active.add(controller); signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timeout = setTimeout(() => controller.abort(), Math.min(this.options.timeoutMs ?? 30_000, 15_000));
    try {
      const res = await fetch(new URL('/api/capabilities', this.options.url), {
        redirect: 'error', signal: controller.signal,
        headers: this.options.initData ? { 'X-Telegram-Init-Data': this.options.initData } : {},
      });
      if (res.status === 404) throw new Fault('BGEN_LIVE_CONTRACT_REQUIRED', 503);
      if (!res.ok) throw new Fault('BGEN_CAPABILITIES_HTTP', 502);
      let p;
      try { p = JSON.parse(await boundedText(res, 4096)); }
      catch (error) { if (error instanceof Fault || controller.signal.aborted) throw error; throw new Fault('BGEN_CAPABILITIES_INVALID', 502); }
      if (!p || p.protocolVersion !== 1 || typeof p.revision !== 'string' || !/^[0-9a-f]{40}$/.test(p.revision) || p.codeGeneration !== true || p.tlsVerification !== true || typeof p.previousCode !== 'boolean') throw new Fault('BGEN_UNSAFE_CAPABILITIES', 503);
      if (p.revision === '419c64968d487068a2fbed2e4bd99489cc734430') throw new Fault('BGEN_AUDITED_REVISION_UNSAFE', 503);
      // These are upstream assertions; they must also agree with the owner's source audit.
      return { protocolVersion: 1, revision: p.revision, codeGeneration: true, tlsVerification: true, previousCode: p.previousCode };
    } catch (error) {
      if (signal?.aborted) throw new Fault('REQUEST_CANCELLED', 499);
      if (controller.signal.aborted) throw new Fault('BGEN_TIMEOUT', 504);
      if (error instanceof Fault) throw error;
      throw new Fault('BGEN_NETWORK', 502);
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); this.active.delete(controller); controller.abort(); }
  }
  async generate(spec: GameSpec, previous?: GameVersion, requestedMethod?: 'llm_code', signal?: AbortSignal): Promise<Artifact> {
    parseSpec(spec);
    requiredMethod(requestedMethod);
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Fault('INSECURE_TLS_CONFIGURATION', 503);
    if (requestedMethod) {
      const capabilities = await this.liveCapabilities(signal);
      if (previous && !capabilities.previousCode) throw new Fault('BGEN_ITERATION_UNSUPPORTED', 503);
    }
    // Current BGen takes prompt + audience; no silent claims that extra fields are honored.
    const prompt = [spec.prompt, `Requirements: genre=${spec.genre}; mechanics=${spec.mechanics.join(',')}; controls=${spec.controls.join(',')}; responsive=${spec.responsive}; webview=${spec.webview}`].join('\n');
    if (prompt.length > 500) throw new Fault('BGEN_PROMPT_TOO_LARGE');
    const previousCodeSha256 = previous ? createHash('sha256').update(previous.html).digest('hex') : undefined;
    const body = JSON.stringify({ prompt, audience: spec.audience, ...(requestedMethod ? { requiredMethod: requestedMethod } : {}), ...(previous ? { previousCode: previous.html, previousPrompt: previous.spec.prompt, ...(requestedMethod ? { previousCodeSha256 } : {}) } : {}) });
    if (Buffer.byteLength(body) > MAX_HTML_BYTES * 6 + 8192) throw new Fault('BGEN_INPUT_TOO_LARGE', 413);
    const controller = new AbortController(), cancel = () => controller.abort();
    this.active.add(controller); signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);
    try {
      const res = await fetch(new URL(previous ? '/api/iterate' : '/api/generate', this.options.url), {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(this.options.initData ? { 'X-Telegram-Init-Data': this.options.initData } : {}) }, body,
      });
      if (!res.ok) throw new Fault(res.status === 401 || res.status === 403 ? 'BGEN_AUTH' : res.status === 429 ? 'BGEN_RATE_LIMIT' : 'BGEN_HTTP', 502);
      let result: Record<string, unknown>;
      try { result = JSON.parse(await boundedText(res, MAX_HTML_BYTES * 6 + 8192)); }
      catch (error) { if (error instanceof Fault) throw error; if (controller.signal.aborted) throw error; throw new Fault('BGEN_INVALID_JSON', 502); }
      if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.ok !== 'boolean' || typeof result.fromCache !== 'boolean' || typeof result.provider !== 'string') throw new Fault('BGEN_INVALID_RESPONSE', 502);
      const provider = result.provider;
      if (requestedMethod) {
        if (!result.ok) throw new Fault('BGEN_GENERATION_FAILED', 502);
        if (previous && result.previousCodeSha256 !== previousCodeSha256) throw new Fault('BGEN_ITERATION_UNCONFIRMED', 502);
        const p = result.provenance as Record<string, unknown> | undefined;
        if (!p || p.method !== requestedMethod || typeof p.provider !== 'string' || !p.provider.trim() || ['mock', 'manual', 'cache'].includes(p.provider) || typeof p.model !== 'string' || !p.model.trim()) throw new Fault('BGEN_CODE_REQUIRED', 502);
      }
      let method: Artifact['method'];
      let model: string | null = null;
      if (result.provenance !== undefined) {
        let p: Record<string, unknown>;
        try { p = object(result.provenance, ['protocolVersion', 'method', 'provider', 'model']); }
        catch { throw new Fault('BGEN_INVALID_PROVENANCE', 502); }
        if (!p || p.protocolVersion !== 1 || typeof p.model !== 'string' && p.model !== null || typeof p.provider !== 'string' && p.provider !== null) throw new Fault('BGEN_INVALID_PROVENANCE', 502);
        method = p.method as Artifact['method'];
        model = p.model as string | null;
        // Explicit metadata must agree with observable mock/default/template labels.
        if ((provider.includes('mock') || typeof p.provider === 'string' && p.provider.includes('mock')) && method !== 'mock' || provider === 'engine+default' && method !== 'fallback' || provider.startsWith('engine+') && !provider.includes('mock') && provider !== 'engine+default' && method !== 'template_config') throw new Fault('BGEN_PROVENANCE_CONFLICT', 502);
        return upstreamArtifact({ html: result.html, method, provider: p.provider, model, generationStatus: result.ok ? 'succeeded' : 'failed', validationStatus: 'unverified' });
      }
      // Audited legacy labels are conservative. Cache loses provenance, raw provider alone
      // cannot prove generated code, and manual output need not originate from an LLM.
      if (result.fromCache) throw new Fault('BGEN_PROVENANCE_REQUIRED', 502);
      if (provider.includes('mock')) method = 'mock';
      else if (provider === 'engine+default') method = 'fallback';
      else if (/^engine\+(openai|anthropic|ollama|gigachat)\+(json|keyvalue)$/.test(provider)) method = 'template_config';
      else throw new Fault('BGEN_PROVENANCE_REQUIRED', 502);
      return upstreamArtifact({ html: result.html, method, provider, model, generationStatus: result.ok ? 'succeeded' : 'failed', validationStatus: 'unverified' });
    } catch (error) {
      if (signal?.aborted) throw new Fault('REQUEST_CANCELLED', 499);
      if (controller.signal.aborted) throw new Fault('BGEN_TIMEOUT', 504);
      if (error instanceof Fault) throw error;
      throw new Fault('BGEN_NETWORK', 502);
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); this.active.delete(controller); controller.abort(); }
  }
}
