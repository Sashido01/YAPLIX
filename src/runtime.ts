import { MAX_HTML_BYTES, parseEvent, uuid } from './contracts.ts';
import type { GameEvent } from './contracts.ts';

export const GAME_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
// Browser API compatibility for old generated bridges on explicit LAN HTTP.
// getRandomValues is available outside secure contexts; never use Math.random.
export const UUID_COMPAT = "if(!crypto.randomUUID)Object.defineProperty(crypto,'randomUUID',{value:()=>{const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);}});";
export interface RuntimeSession { sessionId: string; versionId: string }
export function acceptMessage(message: MessageEvent, source: Window | null, session: RuntimeSession): GameEvent | null {
  if (!source || message.source !== source || message.origin !== 'null') return null;
  try {
    if (!message.data || message.data.channel !== 'yaplix' || Object.keys(message.data).some(k => !['channel', 'event'].includes(k))) return null;
    const event = parseEvent(message.data.event);
    return event.sessionId === session.sessionId && event.versionId === session.versionId ? event : null;
  } catch { return null; }
}
// The UI keeps the session token and HTTP forwarding in the parent. The game gets IDs only.
export function mountGame(container: HTMLElement, html: string, session: RuntimeSession, onEvent: (event: GameEvent) => void): () => void {
  uuid(session.sessionId); uuid(session.versionId);
  if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) throw new Error('ARTIFACT_TOO_LARGE');
  const frame = document.createElement('iframe');
  frame.title = 'YAPLIX game';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; usb 'none'");
  frame.referrerPolicy = 'no-referrer';
  frame.style.cssText = 'width:100%;height:100%;border:0;display:block';
  // CSP is parsed before any attacker-controlled markup or script.
  frame.srcdoc = `<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="${GAME_CSP}"><script>${UUID_COMPAT}</script>` + html;
  let windowStart = Date.now(), count = 0;
  const receive = (message: MessageEvent) => {
    if (Date.now() - windowStart >= 1000) { windowStart = Date.now(); count = 0; }
    if (++count > 60) return;
    const event = acceptMessage(message, frame.contentWindow, session);
    if (event) { try { onEvent(event); } catch { /* UI callback cannot interrupt the game. */ } }
  };
  window.addEventListener('message', receive);
  frame.addEventListener('load', () => frame.contentWindow?.postMessage({ channel: 'yaplix_init', protocolVersion: 1, sessionId:session.sessionId, versionId:session.versionId }, '*'));
  container.append(frame);
  return () => { window.removeEventListener('message', receive); frame.remove(); };
}
