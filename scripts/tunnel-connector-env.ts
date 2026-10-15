import type { ConnectorEnvSource } from './tunnel-connector-env-types.ts';

// TASK-014: cloudflared 2026.10.0 fails quick-tunnel provisioning when
// HTTP_PROXY and HTTPS_PROXY are both set (context deadline exceeded on POST
// https://api.trycloudflare.com/tunnel; reproduced 2026-10-15 with the pinned
// binary through Xray 127.0.0.1:10809). HTTPS-only and no-proxy both work.
// Default policy: the connector runs with proxy variables cleared so the
// provision POST and edge transport stay direct; localhost targets are never
// proxied either way. Explicit opt-in (YAPLIX_TUNNEL_CONNECTOR_PROXY=1 read by
// the caller) forwards inherited system proxy variables unchanged for networks
// where direct egress is impossible. No secrets (bot/LLM keys) are ever part of
// this env block; TLS verification is not touched here or anywhere else.
export const CONNECTOR_PROXY_VARIABLES = ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'] as const;

export interface ConnectorEnvInput {
  source: ConnectorEnvSource;
  tunnelHome: string;
  tunnelTemp: string;
  forwardProxy?: boolean;
}

export function buildConnectorEnvFromParts(
  source: Record<string, string | undefined>,
  tunnelHome: string,
  tunnelTemp: string,
  forwardProxy = false,
): Record<string, string> {
  const env: Record<string, string> = { HOME: tunnelHome, USERPROFILE: tunnelHome, LOCALAPPDATA: tunnelHome, TEMP: tunnelTemp, TMP: tunnelTemp };
  for (const key of ['PATH', 'Path', 'SystemRoot']) if (source[key] !== undefined) env[key] = source[key]!;
  for (const key of CONNECTOR_PROXY_VARIABLES) env[key] = forwardProxy && source[key] !== undefined ? source[key]! : '';
  return env;
}

export function buildConnectorEnv(input: ConnectorEnvInput): Record<string, string> {
  return buildConnectorEnvFromParts(input.source, input.tunnelHome, input.tunnelTemp, input.forwardProxy);
}

export function tunnelConnectorProxyForwarded(source: Record<string, string | undefined>): boolean {
  return source.YAPLIX_TUNNEL_CONNECTOR_PROXY === '1';
}

export type { ConnectorEnvSource };
export type { NodeJS_ProcessEnvLike } from './tunnel-connector-env-types.ts';
