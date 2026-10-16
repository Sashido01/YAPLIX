import { Agent, ProxyAgent } from 'undici';
import type { Dispatcher } from 'undici';
import { Fault } from './contracts.ts';

export type NetworkRoute = 'direct' | 'http-proxy' | 'https-proxy';
export type NetworkDiagnostic = {
  provider: string; route: NetworkRoute | 'configuration';
  stage: 'configuration' | 'connect' | 'response' | 'stream';
  httpStatus?: number; durationMs: number; category: string;
};
export class NetworkFailure extends Fault {
  readonly diagnostic: NetworkDiagnostic;
  constructor(code: string, diagnostic: NetworkDiagnostic) { super(code, 502); this.diagnostic = diagnostic; }
}

// A deliberately small, documented NO_PROXY grammar: hosts, domain suffixes,
// optional ports, IPv6 literals and '*'. No DNS lookups or PAC execution.
export function bypassProxy(url: URL, value: string) {
  const host = url.hostname.toLowerCase(), port = url.port || (url.protocol === 'https:' ? '443' : '80');
  return value.split(/[,\s]+/).some(entry => {
    if (entry === '*') return true;
    const match = entry.match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
    if (!match || match[2] && match[2] !== port) return false;
    const domain = match[1].replace(/^\*?\./, '').toLowerCase();
    return host === domain || host.endsWith('.' + domain);
  });
}
export function networkRoute(url: URL, env: NodeJS.ProcessEnv = process.env): { route: NetworkRoute; proxy?: string } {
  const mode = env.YAPLIX_LLM_NETWORK ?? 'auto';
  if (!['auto', 'direct', 'proxy'].includes(mode)) throw new Fault('LLM_NETWORK_CONFIGURATION');
  if (mode === 'direct') return { route: 'direct' };
  const manual = env.YAPLIX_LLM_PROXY;
  // Lowercase wins even when explicitly empty, consistently on Linux/Windows.
  const https = env.https_proxy ?? env.HTTPS_PROXY, http = env.http_proxy ?? env.HTTP_PROXY;
  const proxy = manual || (mode === 'proxy' ? undefined : url.protocol === 'https:' ? https || http : http);
  if (mode === 'proxy' && !manual) throw new Fault('LLM_NETWORK_CONFIGURATION');
  if (!proxy) {
    if (env.all_proxy || env.ALL_PROXY) throw new Fault('LLM_PROXY_UNSUPPORTED');
    return { route: 'direct' };
  }
  // Validate before NO_PROXY so malformed mandatory settings never fail open.
  let parsed: URL;
  try { parsed = new URL(proxy); decodeURIComponent(parsed.username); decodeURIComponent(parsed.password); }
  catch { throw new Fault('LLM_NETWORK_CONFIGURATION'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Fault('LLM_PROXY_UNSUPPORTED');
  if (parsed.pathname !== '/' || parsed.search || parsed.hash || /[\r\n]/.test(proxy)) throw new Fault('LLM_NETWORK_CONFIGURATION');
  if (mode === 'auto' && bypassProxy(url, env.no_proxy ?? env.NO_PROXY ?? '')) return { route: 'direct' };
  return { route: parsed.protocol === 'https:' ? 'https-proxy' : 'http-proxy', proxy: parsed.href };
}

export function networkCategory(error: unknown, route: NetworkRoute): string {
  const codes: string[] = [], messages: string[] = [];
  const visit = (e: unknown, depth = 0) => {
    if (!e || typeof e !== 'object' || depth > 5) return;
    const value = e as { code?: string; message?: string; cause?: unknown; errors?: unknown[] };
    codes.push(value.code ?? ''); messages.push(value.message ?? '');
    visit(value.cause, depth + 1); value.errors?.slice(0, 8).forEach(x => visit(x, depth + 1));
  };
  visit(error);
  // Inspect bounded library messages only to classify CONNECT status; never emit them.
  if (route !== 'direct' && messages.some(m => /(?:Proxy response \(407\)|Proxy Authentication Required \(407\))/.test(m))) return 'LLM_PROXY_AUTH';
  if (codes.some(c => /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/.test(c))) return 'LLM_TLS';
  if (codes.some(c => ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ETIMEDOUT'].includes(c))) return 'LLM_RESPONSE_TIMEOUT';
  if (route !== 'direct') return 'LLM_PROXY_CONNECTION';
  if (codes.some(c => ['ENOTFOUND', 'EAI_AGAIN'].includes(c))) return 'LLM_DNS';
  if (codes.some(c => ['ECONNREFUSED', 'ECONNRESET', 'UND_ERR_SOCKET'].includes(c))) return 'LLM_TCP_CONNECTION';
  return 'LLM_NETWORK_UNAVAILABLE';
}

// One bounded dispatcher per request, including its response body. No global
// dispatcher mutation, stale proxy cache, credential logging or direct fallback.
export async function networkRequest<T>(url: URL, init: RequestInit, provider: string,
  consume: (response: Response, diagnostic: NetworkDiagnostic) => Promise<T>,
  env: NodeJS.ProcessEnv = process.env): Promise<T> {
  const began = performance.now();
  const diagnostic: NetworkDiagnostic = { provider, route: 'configuration', stage: 'configuration', durationMs: 0, category: 'ok' };
  let dispatcher: Dispatcher | undefined;
  try {
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' || env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Fault('INSECURE_TLS_CONFIGURATION', 503);
    const selected = networkRoute(url, env); diagnostic.route = selected.route;
    const timeout = Number(env.LLM_CONNECT_TIMEOUT_MS ?? 10000);
    if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 30000) throw new Fault('LLM_NETWORK_CONFIGURATION');
    const options = { connections: 1, pipelining: 1, connect: { timeout }, headersTimeout: 0, bodyTimeout: 0 };
    if (selected.proxy) {
      const proxy = new URL(selected.proxy);
      const token = proxy.username || proxy.password ? 'Basic ' + Buffer.from(decodeURIComponent(proxy.username) + ':' + decodeURIComponent(proxy.password)).toString('base64') : undefined;
      proxy.username = ''; proxy.password = '';
      dispatcher = new ProxyAgent({ ...options, uri: proxy.href, token, proxyTls: { timeout }, requestTls: { timeout } });
    } else dispatcher = new Agent(options);
    diagnostic.stage = 'connect';
    const response = await fetch(url, { ...init, dispatcher } as RequestInit & { dispatcher: Dispatcher });
    diagnostic.httpStatus = response.status; diagnostic.stage = 'response';
    return await consume(response, diagnostic);
  } catch (error) {
    // Preserve existing provider/HTML/cancellation contracts and sanitize only
    // network errors. Diagnostic snapshots contain no raw exceptions or URLs.
    if (error instanceof Fault) {
      Object.assign(error, { diagnostic: { ...diagnostic, category: error.code, durationMs: Math.round(performance.now() - began) } });
      throw error;
    }
    const code = init.signal?.aborted ? (init.signal.reason?.name === 'TimeoutError' ? 'LLM_RESPONSE_TIMEOUT' : 'REQUEST_CANCELLED')
      : networkCategory(error, diagnostic.route === 'configuration' ? 'direct' : diagnostic.route);
    diagnostic.category = code; diagnostic.durationMs = Math.round(performance.now() - began);
    if (code === 'LLM_PROXY_AUTH') diagnostic.httpStatus = 407;
    throw new NetworkFailure(code, { ...diagnostic });
  } finally {
    diagnostic.durationMs = Math.round(performance.now() - began);
    await dispatcher?.destroy().catch(() => {});
  }
}
