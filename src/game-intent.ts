// Conservative, local hints for the opt-in prompt. This is not a language parser.
// No corpus imports, generation, filesystem access or network operations.
export type IntentSource = 'EXPLICIT' | 'INFERRED' | 'DEFAULT' | 'UNKNOWN';
export interface Requirement<T> { value: T | null; source: IntentSource; evidence: string | null }
export interface GameIntent {
  originalRequest: string;
  idea: Requirement<string>;
  genre: Requirement<string>;
  audience: Requirement<string>;
  entities: Requirement<string>[];
  actions: Requirement<string>[];
  mechanics: Requirement<string>[];
  numbers: Requirement<{ literal: string; value: number | null; unit: string | null }>[];
  win: Requirement<string>[];
  loss: Requirement<string>[];
  controls: Requirement<string>[];
  presentation: Requirement<string>[];
  // Verbatim clauses, not paraphrases of rules. Includes prohibitions and order.
  requirements: Requirement<string>[];
  conflicts: Requirement<string>[];
  inputStatus: Requirement<'valid' | 'invalid' | 'off_topic' | 'unsafe_instruction' | 'needs_clarification'>;
}

const unknown = <T>(): Requirement<T> => ({ value: null, source: 'UNKNOWN', evidence: null });
const fact = <T>(value: T, evidence: string, source: IntentSource = 'EXPLICIT'): Requirement<T> => ({ value, source, evidence });
// Quotes are game text, not requirements or instructions to the host. Offsets stay intact.
function withoutQuotes(text: string) { return text.replace(/«[^»]*»|"[^"\n]*"|“[^”]*”|`[^`]*`/gu, m => ' '.repeat(m.length)); }
function hits(text: string, patterns: [string, RegExp][], source: IntentSource = 'EXPLICIT') {
  return patterns.flatMap(([value, re]) => {
    const match = text.match(re);
    if (!match) return [];
    const start = match.index!, before = text.slice(Math.max(0, start - 45), start), after = text.slice(start + match[0].length);
    // Do not promote a locally negated mention into a positive requirement.
    // Complex negation is left in the verbatim clauses for the model.
    if (/(?:не\s+(?:хочу\s+|делай\s+|добавляй\s+|надо\s+|нуж[а-яё]*\s+)?|нельзя\s+|без\s+|никаких\s+)$/iu.test(before)
      || /^\s+(?:нельзя|не\s+(?:нуж[а-яё]*|надо|делай|добавляй))/iu.test(after)) return [];
    return [fact(value, match[0], source)];
  });
}
function one<T>(items: Requirement<T>[]): Requirement<T> { return items.length === 1 ? items[0] : unknown<T>(); }
const genreWords: [string, RegExp][] = [
  ['arcade', /(?<![\p{L}])аркад[\p{L}]*/iu], ['platformer', /(?<![\p{L}])платформер[\p{L}]*/iu],
  ['puzzle', /(?<![\p{L}])(?:головоломк[\p{L}]*|пазл[\p{L}]*)/iu], ['clicker', /(?<![\p{L}])кликер[\p{L}]*/iu],
  ['shooter', /(?<![\p{L}])шутер[\p{L}]*/iu], ['racing', /(?<![\p{L}])гонк[\p{L}]*/iu],
];
const namedGames: [string, RegExp][] = [
  ['arcade', /(?<![\p{L}])змейк[\p{L}]*/iu], ['puzzle', /(?<![\p{L}])тетрис[\p{L}]*/iu],
  ['runner', /(?<![\p{L}])раннер[\p{L}]*/iu], ['maze', /(?<![\p{L}])лабиринт[\p{L}]*/iu],
  ['platformer', /(?<![\p{L}])платформир[\p{L}]*/iu],
];
const audienceWords: [string, RegExp][] = [
  ['kids', /для\s+(?:дет[\p{L}]*|реб[её]нк[\p{L}]*)/iu],
  ['elderly', /для\s+пожил[\p{L}]*/iu], ['hardcore', /хардкор[\p{L}]*/iu], ['default', /для\s+всех/iu],
];
const actionWords: [string, RegExp][] = [
  ['jumping', /(?<![\p{L}])(?:прыга[\p{L}]*|прыг[а-яё]*|прыж[\p{L}]*|перепрыг[\p{L}]*)/iu],
  ['collection', /(?<![\p{L}])соб[ие]р[\p{L}]*/iu],
  ['clicking', /(?<![\p{L}])(?:тап[\p{L}]*|нажима[\p{L}]*)/iu],
  ['box_pushing', /двигать\s+ящики/iu], ['matching', /находить\s+одинаковые/iu],
  ['word_building', /складывать\s+слова/iu], ['tower_placement', /башни\s+ставить/iu],
  ['movement', /(?<![\p{L}])(?:двигай|двигать|катается|бежит|уворачивайся)/iu],
  ['survival', /(?<![\p{L}])выжив[\p{L}]*/iu],
  ['shooting', /(?<![\p{L}])стреля[\p{L}]*/iu],
];
const entityWords: [string, RegExp][] = [
  ['snake', /(?<![\p{L}])змейк[\p{L}]*/iu], ['cat', /(?<![\p{L}])кот(?:а|ик)?(?![\p{L}])/iu],
  ['hero', /(?<![\p{L}])геро[йя](?![\p{L}])/iu], ['dragon', /(?<![\p{L}])дракон[\p{L}]*/iu],
  ['ship', /(?<![\p{L}])корабл[\p{L}]*/iu], ['asteroids', /(?<![\p{L}])астероид[\p{L}]*/iu],
  ['boxes', /(?<![\p{L}])ящик[\p{L}]*/iu], ['ball', /(?<![\p{L}])(?:мяч[\p{L}]*|шарик[\p{L}]*)/iu],
  ['fish', /(?<![\p{L}])рыб[\p{L}]*/iu], ['coins', /(?<![\p{L}])монет[\p{L}]*/iu],
  ['key', /(?<![\p{L}])ключ(?![\p{L}])/iu], ['chest', /(?<![\p{L}])сундук[\p{L}]*/iu],
  ['oven', /(?<![\p{L}])печк[\p{L}]*/iu], ['roof', /(?<![\p{L}])крыш[\p{L}]*/iu],
];
const explicitMechanics: [string, RegExp][] = [
  ['purchase', /(?:куп[\p{L}]*[^.!?\n]{0,40}за\s+\d+|за\s+\d+[^.!?\n]{0,30}куп[\p{L}]*)/iu],
  ['passive_income', /(?:приносит|да[её]т)\s+\d+(?:[.,]\d+)?\s+(?:монет[\p{L}]*|очк[\p{L}]*|яблок[\p{L}]*)\s+(?:в\s+секунду|каждые\s+\d+\s+секунд[\p{L}]*)/iu],
  ['levels', /\d+\s+уровн[\p{L}]*/iu], ['lives', /(?<![\p{L}])жизн[\p{L}]*/iu],
  ['no_timer', /без\s+таймера/iu], ['no_score', /без\s+очков/iu],
  ['no_loss', /(?:без\s+(?:очков\s+и\s+)?поражения|проигрывать\s+нельзя)/iu],
  ['endless_play', /(?:без\s+конца\s+игры|конца\s+игры\s+не\s+надо|бесконечн[\p{L}]*)/iu],
];
const inferredMechanics: [string, RegExp][] = [
  ['snake_movement', /змейк/iu], ['food_collection', /змейк/iu], ['growth', /змейк/iu],
  ['falling_blocks', /тетрис/iu], ['line_clear', /тетрис/iu], ['running', /раннер/iu],
  ['obstacle_avoidance', /раннер/iu], ['clicking', /кликер/iu],
];
const forbiddenInference: Record<string, RegExp> = {
  food_collection: /без\s+еды|ед[уы]\s+не\s+(?:собира|добавля)|не\s+собира[\p{L}]*\s+ед/iu,
  growth: /без\s+роста|не\s+раст[её][\p{L}]*/iu,
};
// Narrow host-instruction signals only. The system boundary remains mandatory
// even for attacks this list does not recognise. No user text becomes system text.
const unsafe = /(?:игнорируй\s+(?:все\s+)?(?:правила|инструкции)|забудь\s+инструкции|(?:отключи|ослабь)\s+(?:CSP|защит[\p{L}]*)|(?:покажи|прочитай|отправь)[^.!?\n]{0,60}(?:\.env|ключ\s+сервера|секрет)|подключи\s+платную\s+модель)/iu;

function obviousFiller(text: string): boolean {
  // No vocabulary/genre whitelist. A title, unknown word, number or emoji may
  // be an idea. Reject only symbol-only input or corroborated placeholder runs.
  if (!/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(text)) return true;
  if (/\p{Extended_Pictographic}/u.test(text)) return false;
  if (!/(\d)\1{2,}|[!?._]{3,}/u.test(text)) return false;
  const words = [...text.toLowerCase().matchAll(/\p{L}+/gu)].map(m => m[0]);
  if (!words.length) return /[!?._]{3,}/u.test(text);
  const runs = ['абвгдеёжзийклмнопрстуфхцчшщъыьэюя', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'йцукенгшщзхъ', 'фывапролджэ'];
  return words.every(word => word.length >= 5 && (runs.some(run => run.includes(word)) || /^(.)\1+$/u.test(word)));
}

export function gameIntent(originalRequest: string): GameIntent {
  const unquoted = withoutQuotes(originalRequest);
  // Keep every original clause as untrusted data, including unclassified rules.
  // Full text above also preserves punctuation, whitespace and quoted content.
  const clauses: string[] = [];
  let start = 0;
  for (const separator of unquoted.matchAll(/(?<=[.!?])\s+|\n+/gu)) {
    const clause = originalRequest.slice(start, separator.index);
    if (clause.trim()) clauses.push(clause);
    start = separator.index + separator[0].length;
  }
  if (originalRequest.slice(start).trim()) clauses.push(originalRequest.slice(start));
  const safeClauses = clauses.filter(s => !unsafe.test(withoutQuotes(s)));
  const text = withoutQuotes(safeClauses.join('\n'));
  const explicitGenres = hits(text, genreWords);
  const genre = explicitGenres.length ? one(explicitGenres) : one(hits(text, namedGames, 'INFERRED'));
  let audience = one(hits(text, audienceWords));
  const childAge = text.match(/для\s+(?:сына|дочери)\s+(\d{1,2})\s+лет/iu);
  if (!audience.value && childAge && Number(childAge[1]) < 18) audience = fact('kids', childAge[0], 'INFERRED');
  const actions = hits(text, actionWords);
  // Negative requirements use their own label and keep the explicit negation.
  const negatives = hits(text, explicitMechanics.filter(([label]) => label.startsWith('no_') || label === 'endless_play'));
  const positiveMechanics = [...actions, ...hits(text, explicitMechanics.filter(([label]) => !label.startsWith('no_') && label !== 'endless_play'))];
  const mechanics = [...positiveMechanics, ...negatives, ...hits(text, inferredMechanics, 'INFERRED')
    .filter(r => !positiveMechanics.some(a => a.value === r.value) && !forbiddenInference[r.value!]?.test(text))];
  const win = safeClauses.filter(s => /побед|победить|выигр/iu.test(withoutQuotes(s))).map(s => fact(s, s));
  const loss = safeClauses.filter(s => /проигр|поражен|поражён|поражени/iu.test(withoutQuotes(s))).map(s => fact(s, s));
  const controls = safeClauses.filter(s => /пальц|тап|нажима|управлен|стрелк|клави|кнопк|мыш[ьи]/iu.test(withoutQuotes(s))).map(s => fact(s, s));
  const presentation = safeClauses.filter(s => /оформлен|цвет|фон|пиксел|неон|крупн|звук|без\s+спешки|спокойн/iu.test(withoutQuotes(s))).map(s => fact(s, s));
  const numbers: GameIntent['numbers'] = [];
  // Retain literals and units only. Do not infer that an arbitrary number is a
  // victory target, purchase price, player age or count. Unknown roles stay raw.
  for (const match of text.matchAll(/(?<![\p{L}\d])[-+]?\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?(?:\/\d+)?(?:\s*(?:секунд[\p{L}]*|монет[\p{L}]*|очк[\p{L}]*|рыб[\p{L}]*|зв[её]зд[\p{L}]*|жизн[\p{L}]*|лет|клет[\p{L}]*|волн[\p{L}]*|враг[\p{L}]*|круг[\p{L}]*|падени[\p{L}]*|касани[\p{L}]*|уров[\p{L}]*))?/giu)) {
    const literal = match[0], numeric = literal.match(/^[-+]?\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?(?:\/\d+)?/)![0], value = Number(numeric);
    numbers.push(fact({ literal, value: /^[-+]?\d+$/.test(numeric) && Number.isSafeInteger(value) ? value : null, unit: literal.slice(numeric.length).trim() || null }, literal));
  }
  // Written quantities remain exact text; no speculative numeral conversion.
  for (const match of text.matchAll(/(?<![\p{L}])(?:одн[а-яё]*|дв[ае]|тр[иё][а-яё]*|четв[её]рт[а-яё]*)\s+(?:жизн[\p{L}]*|столкновени[\p{L}]*|волн[\p{L}]*|монет[\p{L}]*|уров[\p{L}]*)/giu)) {
    numbers.push(fact({ literal: match[0], value: null, unit: null }, match[0]));
  }
  const conflicts: GameIntent['conflicts'] = [];
  const conflict = (message: string, evidence: string) => conflicts.push(fact(message, evidence));
  // Only unqualified score rules are comparable. Different levels may have
  // different targets; do not guess that they describe the same scope.
  const thresholds = safeClauses.flatMap(s => {
    const match = s.match(/^\s*победа\s+(?:только\s+)?(?:на|при)\s+(\d+)\s*очк[\p{L}]*[.!?]?\s*$/iu);
    return match ? [match] : [];
  });
  if (new Set(thresholds.map(m => m[1])).size > 1) conflict('Different victory thresholds for the same score require clarification.', thresholds.map(m => m[0]).join('; '));
  if (/без\s+таймера/iu.test(text) && /проигр[\p{L}]*[^.!?\n]*через\s+\d+\s+секунд/iu.test(text)) conflict('No timer and a timed loss may conflict; clarify before generation.', originalRequest);
  if (/нельзя\s+прыгать|без\s+прыжков/iu.test(text) && /(?:чтобы\s+победить|для\s+победы)[^.!?\n]*перепрыг/iu.test(text)) conflict('Victory requires a forbidden jump.', originalRequest);
  if (/пошагов/iu.test(text) && /реальном\s+времени/iu.test(text)) conflict('Turn order and real-time behaviour are unspecified; clarify their relationship.', originalRequest);
  // Multiple genres/audiences may be a valid combination: UNKNOWN, not conflict.
  if (hits(text, [['touch_exclusion', /без\s+(?:сенсорного\s+управления|touch)|только\s+(?:клавиатур[\p{L}]*|мыш[\p{L}]*)/iu]]).length) conflict('Essential controls must also work with touch.', originalRequest);
  if (hits(text, [['network', /(?:подключи|используй|загружай)[^.!?\n]*(?:CDN|https?:\/\/|внешн[\p{L}]*\s+(?:ресурс|библиотек))|(?:онлайн|online)[- ]?(?:мультиплеер|multiplayer)|(?:сетев[\p{L}]*\s+(?:игр|запрос))/iu]]).length) conflict('External resources/networking conflict with standalone offline HTML.', originalRequest);
  const unsafeMatch = unquoted.match(unsafe);
  if (unsafeMatch) conflict('Untrusted host instructions cannot change security, reveal secrets or select paid providers.', unsafeMatch[0]);
  let inputStatus: GameIntent['inputStatus'] = unknown();
  if (!originalRequest.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(originalRequest) || originalRequest.length > 500) inputStatus = fact('invalid', 'Empty, oversized or invalid control characters');
  else if (obviousFiller(originalRequest)) inputStatus = fact('invalid', 'Symbol-only input or corroborated placeholder sequence');
  else if (unsafeMatch) inputStatus = fact('unsafe_instruction', unsafeMatch[0]);
  else if (conflicts.length) inputStatus = fact('needs_clarification', conflicts.map(c => c.evidence).join('; '));
  else if (/^\s*(?:подскажи|дай|напиши)\s+рецепт(?![\p{L}])/iu.test(text)) inputStatus = fact('off_topic', originalRequest);
  else if (genre.value || actions.length || /игр[ауы]|что-нибудь|про\s+[\p{L}]/iu.test(text)) inputStatus = fact('valid', originalRequest, 'INFERRED');
  return { originalRequest, idea: originalRequest.trim() ? fact(originalRequest, originalRequest) : unknown(), genre, audience,
    entities: hits(text, entityWords), actions, mechanics, numbers, win, loss, controls, presentation,
    requirements: clauses.map(s => fact(s, s)), conflicts, inputStatus };
}

/** Wire projection only: rules/numbers/bans stay verbatim in request, once.
 * Detailed facts and evidence remain available internally through gameIntent.
 */
export function compactGameIntent(intent: GameIntent) {
  const groups: Partial<Record<'EXPLICIT' | 'INFERRED', { genre?: string; audience?: string; mechanics?: string[] }>> = {};
  const seenMechanics = new Set<string>();
  for (const source of ['EXPLICIT', 'INFERRED'] as const) {
    const group: { genre?: string; audience?: string; mechanics?: string[] } = {};
    for (const key of ['genre', 'audience'] as const) {
      const requirement = intent[key];
      if (requirement.source === source && requirement.value !== null) group[key] = requirement.value;
    }
    const mechanics: string[] = [];
    for (const requirement of intent.mechanics) {
      if (requirement.source !== source || requirement.value === null || seenMechanics.has(requirement.value)) continue;
      seenMechanics.add(requirement.value);
      mechanics.push(requirement.value);
    }
    if (mechanics.length) group.mechanics = mechanics;
    if (Object.keys(group).length) groups[source] = group;
  }
  return { request: intent.originalRequest, ...groups };
}

export const intentDefaults: Requirement<string>[] = [
  fact('Provide a clear start, explain the actual controls, and make each essential action work.', 'Product gameplay contract', 'DEFAULT'),
  fact('Implement a real repeatable gameplay loop with visible relevant progress; do not force a score into a no-score game.', 'Product gameplay contract', 'DEFAULT'),
  fact('Provide a correct restart to a fresh run. Add win/loss only where appropriate and compatible with explicit rules; do not force a terminal state into endless/no-loss play.', 'Product gameplay contract', 'DEFAULT'),
  fact('Unknown details are not requirements. Choose only minimal implementation details consistent with the verbatim request; do not invent a story, enemies, lives, pickups or numeric goals.', 'Conservative intent policy', 'DEFAULT'),
  fact('Return one standalone offline HTML5 document with inline CSS/JS. Support 320px mobile screens, touch for all essential actions, rotation/safe areas and desktop input; no external resources or networking.', 'Product mobile/offline contract', 'DEFAULT'),
];
