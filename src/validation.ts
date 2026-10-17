import { Fault } from './contracts.ts';
import { extractDocument } from './generation.ts';

export type EvidenceLevel = 'VERIFIED' | 'FAILED' | 'NOT_VERIFIED';
export type ValidationOutcome = EvidenceLevel | 'CHECKER_ERROR';
/** Overall gameplay outcome is distinct from the compatible technical gate level.
 * Missing evidence is never a game defect, and startup is never gameplay proof. */
export function validationOutcome(code?:string,checks?:{level:EvidenceLevel}[]):ValidationOutcome {
  if(!code)return checks?.length===6&&checks.every(c=>c.level==='VERIFIED')?'VERIFIED':'NOT_VERIFIED';
  if(/SANDBOX|INSTALL_REQUIRED|CHECKER_ERROR|STARTUP_FAILED/.test(code))return 'CHECKER_ERROR';
  if(/TIMEOUT|CANCELLED|INCONCLUSIVE/.test(code))return 'NOT_VERIFIED';
  return 'FAILED';
}
export type ValidationAspect = 'html-runs' | 'input-works' | 'gameplay-observed' | 'win-reachable' | 'loss-reachable' | 'restart-works';
export interface ValidationDiagnostic {
  level: EvidenceLevel;
  code: string;
  phase: string;
  feedback: string;
  outcome?: ValidationOutcome;
}
export type FormatRepair = 'JSON_STRING_DOCUMENT' | 'MISSING_DOCTYPE';

/** Decode only an entire JSON string, or add a missing document declaration.
 * Never rewrite a script, selector, attribute, or game mechanic. */
export function prepareDocument(raw: string): { html: string; repair?: FormatRepair } {
  if(/^[\s]*[\[{]/.test(raw)){
    let structured=false;try{JSON.parse(raw);structured=true;}catch{/* Ordinary prose may surround HTML. */}
    if(structured)throw new Fault('LLM_INVALID_HTML',502);
  }
  try { if(!raw.trim().startsWith('"'))return { html: extractDocument(raw) }; } catch (error) {
    if (!(error instanceof Fault) || error.code !== 'LLM_INVALID_HTML') throw error;
  }
  const trimmed = raw.trim();
  if (trimmed.startsWith('"')) {
    let decoded: unknown;
    try { decoded = JSON.parse(trimmed); } catch { /* Not a confirmed serialization wrapper. */ }
    if (typeof decoded === 'string' && /^<!doctype html>/i.test(decoded.trim()) && /<\/html>$/i.test(decoded.trim())) {
      const html = extractDocument(decoded.trim());
      if (html === decoded.trim()) return { html, repair: 'JSON_STRING_DOCUMENT' };
    }
  }
  if (/^<html(?:\s[^>]*|)>/i.test(trimmed) && /<\/html>$/i.test(trimmed) && (trimmed.match(/<html\b/gi) ?? []).length === 1 && !/<!doctype\b/i.test(trimmed)) {
    return { html: extractDocument('<!DOCTYPE html>\n' + trimmed), repair: 'MISSING_DOCTYPE' };
  }
  throw new Fault('LLM_INVALID_HTML', 502);
}
