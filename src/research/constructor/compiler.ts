import { transformSync } from 'esbuild';
import { MAX_HTML_BYTES } from '../../contracts.ts';
import { eventBridge, validateDocument } from '../../generation.ts';
import { GAME_CSP } from '../../runtime.ts';
import { primitivesByKey } from '../../orchestrator/primitives.ts';
import { parseBlueprint } from './blueprint.ts';
import { coreSource, componentSources, shell } from './runtime.ts';

export function compileBlueprint(input: unknown) {
  const began = performance.now(), b = parseBlueprint(input);
  // Parse, never run, the untrusted module on the server. Browser sandbox is
  // the execution boundary; source filtering is only defense in depth.
  if (/<\s*\/|<!--/.test(b.logic)) throw new Error('BLUEPRINT_UNSAFE_LOGIC');
  const module = transformSync('globalThis.constructorInstall(api=>{"use strict";\n' + b.logic + '\n});delete globalThis.constructorInstall;', { loader: 'js', target: 'es2023' }).code;
  const issues = validateDocument('<!DOCTYPE html><html><body><meta name="viewport" content="width=device-width"><script>addEventListener("x",()=>{});' + module + '</script></body></html>');
  if (issues.length) throw new Error('BLUEPRINT_UNSAFE_LOGIC ' + issues.join(','));
  const json = JSON.stringify({ ...b, logic: undefined }).replace(/</g, '\\u003c');
  const primitives = ['grid', 'physics', 'score'].map(key => primitivesByKey.get(key)!.source).join('\n');
  const runtime = eventBridge + '\n' + primitives + '\n' + coreSource + '\n' + b.components.map(c => componentSources[c]).join('\n');
  const html = '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="' + GAME_CSP + '"><title>YAPLIX authored research PoC</title></head><body>' + shell + '<script>(()=>{"use strict";const blueprint=' + json + ';' + runtime + '\nboot();})();</script><script>' + module + '</script></body></html>';
  if (Buffer.byteLength(html) > MAX_HTML_BYTES || validateDocument(html).length) throw new Error('BLUEPRINT_ARTIFACT_REJECTED');
  // Also syntax-check the assembled trusted runtime without executing it.
  transformSync('(()=>{const blueprint=' + json + ';' + runtime + '\nboot();})();', { loader: 'js', target: 'es2023' });
  return { html, metrics: { blueprintBytes: Buffer.byteLength(JSON.stringify(b)), logicBytes: Buffer.byteLength(b.logic), runtimeBytes: Buffer.byteLength(runtime), htmlBytes: Buffer.byteLength(html), compileMs: performance.now() - began } };
}
