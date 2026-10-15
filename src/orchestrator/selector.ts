// TASK-013 mechanics selection: chooses fitting primitives from the library
// for the derived spec. Selection is a technical substrate only — it never
// fixes the game design, which stays the LLM's job. When the library cannot
// even provide a substrate (unrecognized space), generation falls back to the
// proven full-HTML path instead of pretending the library fits.
import type { OrchestratorGameSpec } from './spec.ts';
import type { Primitive } from './primitives.ts';
import { primitivesByKey } from './primitives.ts';

export type SelectionDecision =
  | { decision: 'use-library'; basis: 'grid' | 'free' | 'mixed'; chosen: Primitive[] }
  | { decision: 'scratch'; reason: 'unresolved-space-or-novel-mechanics' };

const UNIVERSAL = ['canvas', 'loop', 'input', 'session', 'score', 'fsm'];

export function selectMechanics(os: OrchestratorGameSpec): SelectionDecision {
  if (os.spaceType === 'unresolved') return { decision: 'scratch', reason: 'unresolved-space-or-novel-mechanics' };
  const keys = [...UNIVERSAL];
  if (os.spaceType === 'grid' || os.spaceType === 'mixed') keys.push('grid');
  if (os.movement.includes('shooting') || os.entities.includes('projectiles') || os.spaceType === 'free' || os.movement.includes('pursuit') || os.movement.includes('gravity') || os.movement.includes('building')) keys.push('physics');
  return { decision: 'use-library', basis: os.spaceType, chosen: keys.map(k => primitivesByKey.get(k)!).filter(Boolean) };
}
