import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Artifact, GameEvent, GameSpec } from '../src/contracts.ts';
export const html = readFileSync(new URL('./fixtures/game.html', import.meta.url), 'utf8');
export const spec: GameSpec = { prompt: 'Collect three points', audience: 'default', genre: 'clicker', mechanics: ['score'], controls: ['keyboard', 'touch', 'pointer'], responsive: true, webview: true };
export const artifact: Artifact = { html, method: 'mock', provider: 'authored-test-fixture', model: null, generationStatus: 'succeeded', validationStatus: 'unverified' };
export function event(session: { sessionId: string; versionId: string }, type: GameEvent['type'], sequence: number, timestamp = Date.now(), data: GameEvent['data'] = {}): GameEvent {
  return { protocolVersion: 1, eventId: randomUUID(), sessionId: session.sessionId, versionId: session.versionId, sequence, type, timestamp, data };
}
