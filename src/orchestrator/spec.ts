// TASK-013 game spec derivation: extracts obvious parameters from the user
// prompt with simple means (no LLM call) and always preserves the verbatim
// original request. Ambiguities stay unresolved; nothing is invented beyond a
// documented default completion objective for games whose prompt contains no
// explicit one. TASK-016 upgrade: mandatory structured game-rule fields that
// the generation prompt must satisfy.
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
  /** TASK-016 mandatory rules block. */
  rules: {
    /** Explicit player goal captured from the prompt; null when not stated. */
    objective: string | null;
    /** Concrete actions the player must be able to perform. */
    actions: string[];
    /** Object-to-object interactions the game must implement. */
    interactions: string[];
    /** How the session progresses; null allows a sensible default. */
    progress: string | null;
    /** Win condition. Prompt conditions win; otherwise a default goal. */
    win: string | null;
    /** Loss condition. Prompt conditions win; otherwise a default loss. */
    loss: string | null;
    /** Restart must exist and return to a fresh playable run. */
    restart: true;
    /** Mobile/touch control is always required alongside keyboard. */
    mobile: true;
    /** Whether win/loss came verbatim from the user (true) or defaults (false). */
    userRulesPriority: boolean;
  };
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

function ruleSentences(prompt: string, patterns: RegExp[]): { matched: string[]; rest: string } {
  // Splits the prompt into sentences; matched ones are removed from `rest` so a
  // default goal is only invented when the user really stated nothing.
  const parts = prompt.split(/(?<=[.!?…])\s+|\n+/).map(s => s.trim()).filter(Boolean);
  const matched: string[] = [];
  const rest: string[] = [];
  for (const part of parts) {
    (patterns.some(p => p.test(part)) ? matched : rest).push(part);
  }
  return { matched, rest: rest.join('. ') };
}

export function orchestratorSpec(prompt: string, base?: Partial<GameSpec>): OrchestratorGameSpec {
  const text = prompt.toLowerCase();
  const has = (...words: string[]) => words.some(w => text.includes(w));
  const spaceType = has(...SPACE_MIXED) ? 'mixed' : has(...SPACE_GRID) ? 'grid' : has(...SPACE_FREE) ? 'free' : 'unresolved';
  const entities = [
    ...(has('враг', 'enemy', 'противник') ? ['enemies'] : []),
    ...(has('бонус', 'бонусы', 'bonus', 'монет', 'coin', 'собира') ? ['collectibles'] : []),
    ...(has('стрельб', 'shoot', 'shooting', 'стреля', 'снаряд', 'пуля', 'пул', 'gun', 'fire') ? ['projectiles'] : []),
    ...(has('препятств', 'obstacle', 'астероид', 'asteroid') ? ['obstacles'] : []),
    ...(has('стен', 'wall') ? ['walls'] : []),
  ];
  const movement = [
    ...(has('вращ', 'rotate', 'поворот') ? ['rotation'] : []),
    ...(has('пад', 'fall', 'гравит') ? ['gravity'] : []),
    ...(has('прыж', 'jump') ? ['jumping'] : []),
    ...(has('преслед', 'pursue', 'погон') ? ['pursuit'] : []),
    ...(has('стрельб', 'shoot', 'shooting', 'стреля', 'снаряд', 'пуля', 'gun', 'fire') ? ['shooting'] : []),
    ...(has('строит', 'build', 'возвод') ? ['building'] : []),
  ];
  const interactions = [
    ...(has('столкн', 'collide', 'collision', 'взрыв', 'explosion') ? ['collisions'] : []),
    ...(has('очко', 'score', 'point') ? ['score'] : []),
    ...(has('жизн', 'life', 'здоров', 'health') ? ['health'] : []),
    ...(has('уровн', 'level', 'волн', 'wave', 'этап') ? ['leveling'] : []),
  ];

  // --- TASK-016 mandatory rules -------------------------------------------------
  // Verbatim user conditions win (userRulesPriority). Loss sentences need a
  // strong loss word; a bare "жизни" mention is only a signals, not the rule
  // text. For prompts without any stated completion condition, a documented
  // default completion objective is derived from the mechanics that ARE
  // requested - no invented gameplay.
  const winRaw = ruleSentences(prompt, [/поб[ао]д/i, /\bwin/i, /прой[dt]/i, /заверш[иа]/i, /цел[ьи]/i, /goal/i]);
  const lossRaw = ruleSentences(prompt, [/пораж/i, /проигр/i, /потеря/i, /\bloss/i, /смерт/i, /\bhp\b/i, /переполн/i]);
  const hasLives = has('жизн', 'life', 'здоров', 'health');
  // Loss condition candidates from mechanics the prompt does name: losing all
  // "lives" needs no invention; otherwise stack overflow / caught by enemies /
  // collisions are natural for the named mechanics.
  const lossDefault = lossRaw.matched[0]
    ?? (hasLives ? 'Потеря всех жизней завершает игру поражением.' : null)
    ?? (entities.includes('enemies') ? 'Захвачен преследующим противником или лишён всех жизней.' : null)
    ?? (spaceType === 'grid' ? 'Переполнение поля: фигуры/блоки достигают верха.' : null)
    ?? (spaceType === 'free' ? 'Столкновение с препятствием или противником завершает игру.' : null)
    ?? (spaceType === 'mixed' ? 'Змейка сталкивается со стеной, собой или врагом.' : null);

  let objectiveDefault: string | null;
  let winDefault: string | null;
  if (interactions.includes('leveling')) {
    objectiveDefault = 'Пройти конечное число волн/уровней, заявленных в описании игры.';
    winDefault = 'Выжить и очистить все волны/уровни до их исчерпания.';
  } else if (entities.includes('collectibles')) {
    objectiveDefault = 'Собрать конечное число заявленных предметов (например, 10) до наступления условия поражения.';
    winDefault = 'Собрать целевое число предметов до поражения.';
  } else if (entities.includes('enemies')) {
    objectiveDefault = 'Уничтожить или пережить конечное число заявленных противников и достичь целевого счёта.';
    winDefault = 'Достичь целевого счёта, уничтожив/пережив противников, до поражения.';
  } else if (spaceType === 'grid') {
    objectiveDefault = 'Набрать целевое количество очков (например, 200) до наступления условия поражения.';
    winDefault = 'Достичь целевого счёта до поражения.';
  } else if (spaceType === 'free') {
    objectiveDefault = 'Уничтожить/пережить конечное число препятствий и достичь целевого счёта.';
    winDefault = 'Достичь целевого счёта до столкновения с препятствием/противником.';
  } else {
    // Unresolved space: no rules are invented at all.
    objectiveDefault = null;
    winDefault = null;
  }
  const userWin = winRaw.matched[0] ?? null;
  const userLoss = lossRaw.matched[0] ?? null;
  const actions: string[] = [
    'двигаться (стрелки/WASD и видимые кнопки на экране)',
    ...(movement.includes('rotation') ? ['вращать (rotate)'] : []),
    ...(movement.includes('shooting') ? ['стрелять'] : []),
    ...(movement.includes('building') ? ['строить/ставить блоки'] : []),
    ...(entities.includes('projectiles') && !movement.includes('shooting') ? ['стрелять'] : []),
    ...(has('пробел', 'space', 'сброс') ? ['мгновенный сброс (hard drop)'] : []),
  ];
  const ruleInteractions: string[] = [
    ...(entities.includes('enemies') ? ['столкновение с противником наносит урон/жизни'] : []),
    ...(entities.includes('projectiles') ? ['снаряды уничтожают противников/объекты'] : []),
    ...(entities.includes('collectibles') ? ['сбор предметов увеличивает счёт/прогресс'] : []),
    ...(entities.includes('obstacles') ? ['препятствия блокируют/повреждают игрока'] : []),
    ...(has('взрыв', 'explosion') ? ['взрыв удаляет занятые клетки поля и начисляет очки'] : []),
    ...(['score'].some(i => interactions.includes(i)) ? ['счёт растёт от игровых событий'] : []),
    ...(['health'].some(i => interactions.includes(i)) ? ['жизни/здоровье уменьшаются от урона'] : []),
    ...(['leveling'].some(i => interactions.includes(i)) ? ['волны/уровни усложняются'] : []),
  ];
  const objective = userWin ?? objectiveDefault;
  return {
    originalRequest: prompt,
    audience: base?.audience ?? (has('дет', 'kid', 'child') ? 'kids' : has('хардкор', 'hardcore') ? 'hardcore' : has('пожил', 'elderly') ? 'elderly' : 'default'),
    spaceType,
    controls: base?.controls ?? ['keyboard', 'touch', 'pointer'],
    entities,
    movement,
    interactions,
    winRule: matchFirst(prompt, [/([^.!?\n]{0,180}(?:поб[ао]д|win)[^.!?\n]{0,120})/i]),
    lossRule: matchFirst(prompt, [/([^.!?\n]{0,180}(?:пораж|проигр|потеря|loss)[^.!?\n]{0,120})/i, /([^.!?\n]{0,150}(?:столкновени|столкновение)[^.!?\n]{0,120})/i]),
    rules: {
      objective,
      actions,
      interactions: ruleInteractions,
      progress: interactions.includes('leveling') ? 'Волны/уровни усложняются по мере прогресса.' : (entities.includes('collectibles') ? 'Счёт и собранные предметы показывают прогресс.' : 'Счёт показывает прогресс.'),
      win: userWin ?? winDefault,
      loss: userLoss ?? lossDefault,
      restart: true,
      mobile: true,
      userRulesPriority: Boolean(userWin || userLoss),
    },
  };
}
