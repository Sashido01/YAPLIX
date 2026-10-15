// TASK-013 game spec derivation: extracts obvious parameters from the user
// prompt with simple means (no LLM call) and always preserves the verbatim
// original request. Ambiguities stay unresolved; nothing is invented.
import type { GameSpec } from '../contracts.ts';

export interface OrchestratorGameSpec {
  originalRequest: string;
  audience: GameSpec['audience'];
  spaceType: 'grid' | 'free' | 'mixed' | 'unresolved';
  controls: GameSpec['controls'];
  entities: string[];
  movement: string[];
  interactions: string[];
  winRule: string | null;
  lossRule: string | null;
}

const SPACE_GRID = ['сетк', 'grid', 'лабиринт', 'maze', 'тетрис', 'tetris', 'клетк', 'падающ'];
const SPACE_FREE = ['косм', 'space', 'аркад', 'arcade', 'корабл', 'asteroid', 'астероид', 'стрельб', 'shooter', 'уклоня'];
const SPACE_MIXED = ['змейка', 'snake'];

function matchFirst(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const found = text.match(pattern);
    if (found && found[1]) return found[1].trim().slice(0, 200);
  }
  return null;
}

export function orchestratorSpec(prompt: string, base?: Partial<GameSpec>): OrchestratorGameSpec {
  const text = prompt.toLowerCase();
  const has = (...words: string[]) => words.some(w => text.includes(w));
  return {
    originalRequest: prompt,
    audience: base?.audience ?? (has('дет', 'kid', 'child') ? 'kids' : has('хардкор', 'hardcore') ? 'hardcore' : has('пожил', 'elderly') ? 'elderly' : 'default'),
    spaceType: has(...SPACE_MIXED) ? 'mixed' : has(...SPACE_GRID) ? 'grid' : has(...SPACE_FREE) ? 'free' : 'unresolved',
    controls: base?.controls ?? ['keyboard', 'touch', 'pointer'],
    entities: [
      ...(has('враг', 'enemy', 'противник') ? ['enemies'] : []),
      ...(has('бонус', 'бонусы', 'bonus', 'монет', 'coin', 'собира') ? ['collectibles'] : []),
      ...(has('стрельб', 'shoot', 'shooting', 'стреля', 'снаряд', 'пуля', 'пул', 'gun', 'fire') ? ['projectiles'] : []),
      ...(has('препятств', 'obstacle', 'астероид', 'asteroid') ? ['obstacles'] : []),
      ...(has('стен', 'wall') ? ['walls'] : []),
      ...(has('бочен', 'barrel') ? [] : []),
    ],
    movement: [
      ...(has('вращ', 'rotate', 'поворот') ? ['rotation'] : []),
      ...(has('пад', 'fall', 'гравит') ? ['gravity'] : []),
      ...(has('прыж', 'jump') ? ['jumping'] : []),
      ...(has('преслед', 'pursue', 'погон') ? ['pursuit'] : []),
      ...(has('стрельб', 'shoot', 'shooting', 'стреля', 'снаряд', 'пуля', 'gun', 'fire') ? ['shooting'] : []),
      ...(has('строит', 'build', 'возвод') ? ['building'] : []),
    ],
    interactions: [
      ...(has('столкн', 'collide', 'collision', 'взрыв', 'explosion') ? ['collisions'] : []),
      ...(has('очко', 'score', 'point') ? ['score'] : []),
      ...(has('жизн', 'life', 'здоров', 'health') ? ['health'] : []),
      ...(has('уровн', 'level', 'волн', 'wave', 'этап') ? ['leveling'] : []),
    ],
    winRule: matchFirst(prompt, [/([^.!?\n]{0,180}(?:поб[ао]д|win)[^.!?\n]{0,120})/i]),
    lossRule: matchFirst(prompt, [/([^.!?\n]{0,180}(?:пораж|проигр|потеря|loss)[^.!?\n]{0,120})/i, /([^.!?\n]{0,150}(?:столкновени|столкновение)[^.!?\n]{0,120})/i]),
  };
}
