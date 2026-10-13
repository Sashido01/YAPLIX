import { Fault } from './contracts.ts';
import type { Artifact, GameSpec, GameVersion } from './contracts.ts';

export interface Generator {
  generate(spec: GameSpec, previous?: GameVersion, method?: 'llm_code', signal?: AbortSignal): Promise<Artifact>;
  close?(): void;
}
export function requiredMethod(value: unknown): 'llm_code' | undefined {
  if (value === undefined) return;
  if (value !== 'llm_code') throw new Fault('INVALID_REQUIRED_METHOD');
  return value;
}
export async function boundedText(response: Response, limit: number) {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Fault('BODY_TOO_LARGE', 413); }
  const reader = response.body?.getReader(); if (!reader) return '';
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > limit) throw new Fault('BODY_TOO_LARGE', 413); parts.push(part.value); }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export type Message = { role: 'system' | 'user' | 'assistant'; content: string };
export interface CodeTransport {
  route: 'primary' | 'secondary' | 'local'; provider: string; model: string;
  complete(messages: Message[], signal: AbortSignal): Promise<{ code: string; model: string }>;
  readiness(signal: AbortSignal): Promise<string>;
}
function endpoint(base: string, local: boolean) {
  let url: URL;
  try { url = new URL(base); } catch { throw new Fault('INVALID_LLM_CONFIGURATION'); }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname)))) throw new Fault('INSECURE_LLM_URL');
  if (local && url.pathname !== '/') throw new Fault('INVALID_LLM_CONFIGURATION');
  return new URL(url.href.replace(/\/$/, '') + '/');
}
export class CloudTransport implements CodeTransport {
  readonly route: 'primary' | 'secondary'; readonly provider: string; readonly model: string;
  private base: URL; private key: string; private maxTokens: number; private temperature?: number; private tokenField: 'max_tokens' | 'max_completion_tokens';
  constructor(options: { base: string; key: string; model: string; route?: 'primary' | 'secondary'; maxTokens?: number; temperature?: number; tokenField?: 'max_tokens' | 'max_completion_tokens' }) {
    this.base = endpoint(options.base, false); this.key = options.key; this.model = options.model; this.route = options.route ?? 'primary';
    this.provider = this.base.hostname === 'openrouter.ai' ? 'openrouter' : this.base.hostname;
    this.maxTokens = options.maxTokens ?? 12000; this.temperature = options.temperature; this.tokenField = options.tokenField ?? 'max_tokens';
    if (!this.key.trim() || /[\r\n]/.test(this.key) || this.key.length > 4096 || !this.model.trim() || this.model.length > 128 || this.provider.length > 128 || !Number.isSafeInteger(this.maxTokens) || this.maxTokens < 256 || this.maxTokens > 32000 || this.temperature !== undefined && (!Number.isFinite(this.temperature) || this.temperature < 0 || this.temperature > 2) || !['max_tokens','max_completion_tokens'].includes(this.tokenField)) throw new Fault('INVALID_LLM_CONFIGURATION');
    // This project's OpenRouter authorization is FREE ONLY, including secondary routes.
    if (this.provider === 'openrouter' && (this.base.href !== 'https://openrouter.ai/api/v1/' || this.model !== 'openrouter/free')) throw new Fault('FREE_MODEL_REQUIRED');
  }
  private async request(path: string, signal: AbortSignal, body?: object) {
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Fault('INSECURE_TLS_CONFIGURATION', 503);
    const response = await fetch(new URL(path, this.base), { method: body ? 'POST' : 'GET', redirect: 'error', signal, headers: { Authorization: 'Bearer ' + this.key, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) { await response.body?.cancel(); throw new Fault(response.status === 401 || response.status === 403 ? 'LLM_AUTH' : response.status === 429 ? 'LLM_RATE_LIMIT' : 'LLM_HTTP', response.status === 429 ? 429 : 502); }
    try { return JSON.parse(await boundedText(response, 1_210_000)); } catch (error) { if (signal.aborted || error instanceof Fault) throw error; throw new Fault('LLM_INVALID_RESPONSE', 502); }
  }
  async complete(messages: Message[], signal: AbortSignal) {
    const result = await this.request('chat/completions', signal, { model: this.model, messages, stream: false, [this.tokenField]: this.maxTokens, ...(this.temperature === undefined ? {} : { temperature: this.temperature }) });
    const choice = result.choices?.[0];
    if (result.error || choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string' || typeof result.model !== 'string' || !result.model.trim() || result.model.length > 128) throw new Fault('LLM_INVALID_RESPONSE', 502);
    // Free router intentionally reports the actual selected free model, not its router alias.
    return { code: choice.message.content, model: result.model };
  }
  async readiness(signal: AbortSignal) {
    try { const result = await this.request('models', signal); return Array.isArray(result.data) && result.data.some((m: {id?:string}) => m.id === this.model) ? 'ready' : 'model_missing'; }
    catch (error) { return error instanceof Fault && error.code === 'LLM_AUTH' ? 'authentication_failed' : 'unreachable'; }
  }
}
export class OllamaTransport implements CodeTransport {
  readonly route = 'local'; readonly provider = 'ollama'; readonly model: string; private base: URL;
  constructor(options: { base?: string; model?: string } = {}) { this.base = endpoint(options.base ?? 'http://127.0.0.1:11434', true); this.model = options.model ?? 'qwen2.5-coder:14b'; if (!this.model.trim() || this.model.length > 128) throw new Fault('INVALID_LLM_CONFIGURATION'); }
  async complete(messages: Message[], signal: AbortSignal) {
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Fault('INSECURE_TLS_CONFIGURATION', 503);
    const response = await fetch(new URL('api/chat', this.base), { method:'POST',redirect:'error',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({model:this.model,messages,stream:false,think:false,options:{temperature:0.2,num_predict:12000,num_ctx:16384}}) });
    if (!response.ok) { await response.body?.cancel(); throw new Fault(response.status === 404 ? 'LLM_MODEL_NOT_FOUND' : 'LLM_HTTP',502); }
    let result; try { result = JSON.parse(await boundedText(response,1_210_000)); } catch(error) { if(signal.aborted || error instanceof Fault)throw error;throw new Fault('LLM_INVALID_RESPONSE',502); }
    if (result.done !== true || result.done_reason && result.done_reason !== 'stop' || result.model !== this.model || typeof result.message?.content !== 'string') throw new Fault('LLM_INVALID_RESPONSE',502);
    return {code:result.message.content,model:result.model};
  }
  async readiness(signal: AbortSignal) {
    try { const response=await fetch(new URL('api/tags',this.base),{signal,redirect:'error'});const result=JSON.parse(await boundedText(response,100000));return response.ok && Array.isArray(result.models) ? result.models.some((m:{name?:string})=>m.name===this.model)?'ready':'model_missing':'unreachable'; } catch {return 'unreachable';}
  }
}
