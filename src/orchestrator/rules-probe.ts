// Bounded, deliberately small rules interpreter. No generated source is executed
// or inspected here: only declared rules, read-only HUD and rendered pixels.
import type { Evidence, GameplayRules } from './gameplay-check.ts';

export type Metric = 'score' | 'items' | 'lines' | 'waves';
export interface Goal { metric: Metric; target: number; source: 'rules.win' | 'rules.win+HUD' }
export interface GoalResolution { goal: Goal | null; reason: string }
export interface TerminalView { visible: boolean; text: string; score: string }
export interface ProbeEvent { type: string; data?: { score?: number } }
export interface Sample {
  ms: number; actions: number; hud: Record<string, unknown>; progress: number | null;
  terminal: TerminalView; events: ProbeEvent[]; pixels?: string[];
  /** Rendered head entering the preceding rendered collectible cell. */
  contacts?: number;
}
export interface PlayerAction { ms: number; kind: 'start' | 'key' | 'button' | 'wait' | 'restart'; value: string }
export interface WinProof { level: Evidence; reason: string }

const aliases: Record<Metric, RegExp> = {
  score: /score|points?|сч[её]т|очк/iu,
  items: /apples?|items?|collectibles?|яблок|предмет/iu,
  lines: /lines?|лини/iu,
  waves: /waves?|волн/iu,
};
function metricOf(text: string): Metric | null {
  const matches = (Object.keys(aliases) as Metric[]).filter(key => aliases[key].test(text));
  return matches.length === 1 ? matches[0]! : null;
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const fields: Record<Metric, string[]> = { score: ['score'], items: ['collected', 'apples', 'items'], lines: ['lines', 'linesCleared'], waves: ['waves', 'wavesCleared'] };
export function progressOf(hud: Record<string, unknown>, metric: Metric): number | null {
  const values = fields[metric].flatMap(key => {
    const value = hud[key];
    if (finite(value)) return [value];
    const ratio = typeof value === 'string' && value.match(/^(\d+)\s*\/\s*(\d+)$/);
    return ratio ? [Number(ratio[1])] : [];
  });
  return values.length && new Set(values).size === 1 ? values[0]! : null;
}
export function resolveGoal(rules: GameplayRules, hud: Record<string, unknown>): GoalResolution {
  const win = rules.win ?? '';
  // Compound, conditional, timed and example-only claims are intentionally out
  // of scope. Never mine objective/loss examples for a completion threshold.
  if (!win || /\bor\b|\band\b|\bif\b|\bseconds?\b|\bminutes?\b|\bexactly\b|\bunder\b|\bat most\b|\bnot\b|\bnever\b|\bno\b|\bbefore\b|\bafter\b|\bwithin\b|\babove\b|\bbelow\b|\bover\b|more than|fewer than|greater than|less than|или|\sи\s|секунд|минут|ровно|\bне\b|более|меньше|больше|например|example/iu.test(win)) return { goal: null, reason: 'unsupported or ambiguous win rule' };
  const metric = metricOf(win);
  if (!metric) return { goal: null, reason: 'win rule has no single supported numeric metric' };
  // A small vocabulary, not a general natural-language parser. Unknown words
  // might add a condition; do not silently erase their meaning.
  const vocabulary = /^(?:win|goal|reach|collect|clear|complete|target|score|points?|apples?|items?|collectibles?|lines?|waves?|at|least|to|the|a|победа|достичь|набрать|собрать|очистить|целевого|целевой|целевое|число|количество|счета|счет|очков|очки|яблок|яблока|яблоко|предметов|предмета|предметы|линий|линии|волн|волны|до|поражения|\d+)$/u;
  if (win.toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}]+/gu)?.some(word => !vocabulary.test(word)) || /[-−]\s*\d|[<>=≤≥≠+*/%]/u.test(win)) return { goal: null, reason: 'unsupported words or numeric relation in win rule' };
  if (!/reach|collect|clear|complete|win|target|goal|достич|собра|очист|набрат|побед|целев/iu.test(win)) return { goal: null, reason: 'no supported threshold relation in win rule' };
  const numbers = win.match(/\d+(?:[.,]\d+)?/g) ?? [];
  if (numbers.length > 1) return { goal: null, reason: 'multiple thresholds in win rule' };
  const explicit = numbers.length === 1 ? Number(numbers[0]!.replace(',', '.')) : null;
  const hudTargets: number[] = [];
  if (finite(hud.target)) hudTargets.push(hud.target);
  for (const key of fields[metric]) {
    const ratio = typeof hud[key] === 'string' && (hud[key] as string).match(/^\d+\s*\/\s*(\d+)$/);
    if (ratio) hudTargets.push(Number(ratio[1]));
  }
  if (new Set(hudTargets).size > 1 || (explicit !== null && hudTargets.some(n => n !== explicit))) return { goal: null, reason: 'rule/HUD target conflict' };
  const target = explicit ?? hudTargets[0] ?? null;
  if (target === null || !Number.isSafeInteger(target) || target <= 0 || target > 1000000) return { goal: null, reason: 'no bounded positive integer target' };
  return { goal: { metric, target, source: explicit === null ? 'rules.win+HUD' : 'rules.win' }, reason: 'single cumulative threshold' };
}

/** A bridge event is one witness, never the verdict. Samples are run-local. */
export function proveWin(goal: Goal | null, samples: Sample[], actions: PlayerAction[], errors: string[]): WinProof {
  if (errors.length) return { level: 'FAILED', reason: 'browser/runtime violation: ' + errors[0] };
  const last = samples.at(-1);
  if (!last || !goal) return { level: 'NOT_VERIFIED', reason: 'numeric win goal is unresolved' };
  const events = last.events.map(e => e.type);
  if (events.filter(e => e === 'game_ready').length > 1 || events.filter(e => e === 'game_started').length > 1) return { level: 'FAILED', reason: 'unsolicited document/session reset during proof' };
  const won = events.includes('game_won');
  const ended = events.includes('session_ended');
  const visibleWin = last.terminal.visible && /^you win!$/i.test(last.terminal.text.trim());
  const initial = samples.find(s => s.progress !== null && s.actions === 1)?.progress;
  const final = last.progress;
  if (won && ended && visibleWin && final !== null && final < goal.target) return { level: 'FAILED', reason: 'victory screen below the declared threshold' };
  if (won && (!ended || !visibleWin)) return { level: 'FAILED', reason: 'uncorroborated game_won: no completed victory screen' };
  if (final !== null && final >= goal.target && !visibleWin && !events.includes('game_lost')) return { level: 'FAILED', reason: 'threshold reached without completion' };
  const played = actions.some(a => a.kind === 'key' || a.kind === 'button' && !['pause', 'continue'].includes(a.value));
  const progressed = initial !== null && initial !== undefined && initial < goal.target && final !== null && final > initial;
  const stable = samples.length >= 2 && samples.slice(-2).every(s => s.progress !== null && s.progress >= goal.target && s.terminal.visible && /^you win!$/i.test(s.terminal.text.trim()));
  const ordered = events.indexOf('game_started') >= 0 && events.indexOf('game_won') > events.indexOf('game_started') && events.indexOf('session_ended') > events.indexOf('game_won') && !events.includes('game_lost');
  const score = last.events.filter(e => e.type === 'score_changed').at(-1)?.data?.score;
  const scoreCoherent = goal.metric !== 'score' || (score === final && last.terminal.score.trim() === 'score: ' + final);
  const contactsCoherent = last.contacts === undefined || (initial !== null && initial !== undefined && final !== null && last.contacts >= final - initial);
  if (won && ended && visibleWin && played && progressed && stable && ordered && scoreCoherent && contactsCoherent) return { level: 'VERIFIED', reason: 'real input + HUD threshold + ordered outcome/end + stable visible victory' };
  return { level: 'NOT_VERIFIED', reason: 'insufficient independent action/progress/completion evidence within budget' };
}

export interface GridView { cols: number; rows: number; cells: string[] }
export interface SnakePalette { head: string; body: string; apple: string; wall: string; enemy: string }
export type Direction = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
const moves: [Direction, number, number][] = [['ArrowLeft', -1, 0], ['ArrowRight', 1, 0], ['ArrowUp', 0, -1], ['ArrowDown', 0, 1]];
/** Shortest safe next step from the *rendered* board; no game object access. */
export function snakeStep(view: GridView, palette: SnakePalette): Direction | null {
  const heads = view.cells.flatMap((c, i) => c === palette.head ? [i] : []);
  const targets = view.cells.flatMap((c, i) => c === palette.apple ? [i] : []);
  if (heads.length !== 1 || targets.length !== 1) return null;
  const start = heads[0]!, target = targets[0]!;
  const seen = new Set([start]);
  const queue: { at: number; first: Direction | null }[] = [{ at: start, first: null }];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]!;
    if (node.at === target) return node.first;
    for (const [key, dx, dy] of moves) {
      const x = node.at % view.cols + dx, y = Math.floor(node.at / view.cols) + dy;
      const at = y * view.cols + x;
      if (x < 0 || y < 0 || x >= view.cols || y >= view.rows || seen.has(at)) continue;
      if ([palette.wall, palette.body, palette.head, palette.enemy].includes(view.cells[at]!)) continue;
      // Stay outside the immediate enemy neighborhood when there is room.
      if (moves.some(([, ex, ey]) => x + ex >= 0 && x + ex < view.cols && y + ey >= 0 && y + ey < view.rows && view.cells[(y + ey) * view.cols + x + ex] === palette.enemy)) continue;
      seen.add(at); queue.push({ at, first: node.first ?? key });
    }
  }
  return null;
}
