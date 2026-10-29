import { GAME_AUDIENCES, GAME_CONSTRAINTS, GAME_GENRES, GAME_MECHANICS, GAME_PRESENTATION, GAME_VOCABULARY, VOCABULARY_VERSION, normalizeVocabularyText, vocabularyOccurrences } from './game-vocabulary.ts';

// Conservative, local hints for the opt-in prompt. This is not a language parser.
// No corpus imports, generation, filesystem access or network operations.
export type IntentSource = 'EXPLICIT' | 'INFERRED' | 'DEFAULT' | 'UNKNOWN';
export interface Requirement<T> { value: T | null; source: IntentSource; evidence: string | null }
export interface GameIntent {
  originalRequest: string;
  idea: Requirement<string>;
  genre: Requirement<string>;
  archetypes: Requirement<string>[];
  audience: Requirement<string>;
  entities: Requirement<string>[];
  actions: Requirement<string>[];
  mechanics: Requirement<string>[];
  numbers: Requirement<{ literal: string; value: number | null; unit: string | null }>[];
  win: Requirement<string>[];
  loss: Requirement<string>[];
  controls: Requirement<string>[];
  presentation: Requirement<string>[];
  constraints: Requirement<string>[];
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
const genreWords = GAME_GENRES;
const audienceWords = GAME_AUDIENCES;
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
  ['no_loss', /(?:без\s+(?:очков\s+и\s+)?(?:поражения|проигрыша)|проигрывать\s+нельзя)/iu],
  ['endless_play', /(?:без\s+конца\s+игры|конца\s+игры\s+не\s+надо|бесконечн[\p{L}]*)/iu],
];
const inferredMechanics: [string, RegExp][] = [
  ['snake_movement', /змейк/iu], ['food_collection', /змейк/iu], ['growth', /змейк/iu],
  ['snake_collision', /змейк/iu], ['score', /змейк/iu], ['falling_blocks', /тетрис/iu], ['line_clear', /тетрис/iu], ['piece_rotation', /тетрис/iu], ['running', /раннер/iu],
  ['obstacle_avoidance', /раннер/iu], ['clicking', /кликер/iu],
];
const forbiddenInference: Record<string, RegExp> = {
  food_collection: /без\s+еды|ед[уы]\s+не\s+(?:собира|добавля)|не\s+собира[\p{L}]*\s+ед/iu,
  growth: /без\s+(?:еды\s+и\s+)?роста|не\s+раст[её][\p{L}]*/iu,
  score: /без\s+очк[\p{L}]*|без\s+сч[её]та/iu,
  snake_collision: /без\s+столкновен[\p{L}]*|не\s+(?:проигрыва|заканчива)[\p{L}]*/iu,
  piece_rotation: /без\s+поворот[\p{L}]*|не\s+поворачива[\p{L}]*/iu,
  enemy_path:/без\s+(?:враг[\p{L}]*|противник[\p{L}]*)|no\s+enemies/iu,
  range_attack:/без\s+(?:враг[\p{L}]*|противник[\p{L}]*)|no\s+enemies/iu,
  lives:/без\s+жизн[\p{L}]*|no\s+lives/iu,
};
// Narrow host-instruction signals only. The system boundary remains mandatory
// even for attacks this list does not recognise. No user text becomes system text.
const unsafe = /(?:игнорируй\s+(?:все\s+)?(?:правила|инструкции)|забудь\s+инструкции|(?:отключи|ослабь)\s+(?:CSP|защит[\p{L}]*)|(?:покажи|прочитай|отправь)[^.!?\n]{0,60}(?:\.env|ключ\s+сервера|секрет)|подключи\s+платную\s+модель)/iu;

function obviousFiller(text: string): boolean {
  // No vocabulary/genre whitelist. A title, unknown word, number or emoji may
  // be an idea. Reject only symbol-only input or corroborated placeholder runs.
  if (!/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(text)) return true;
  if (/^\s*(\p{L})\1{63,}\s*$/iu.test(text)) return true;
  if (/\p{Extended_Pictographic}/u.test(text)) return false;
  if (!/(\d)\1{2,}|[!?._]{3,}/u.test(text)) return false;
  const words = [...text.toLowerCase().matchAll(/\p{L}+/gu)].map(m => m[0]);
  if (!words.length) return /[!?._]{3,}/u.test(text);
  const runs = ['абвгдеёжзийклмнопрстуфхцчшщъыьэюя', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'йцукенгшщзхъ', 'фывапролджэ'];
  return words.every(word => word.length >= 5 && (runs.some(run => run.includes(word)) || /^(.)\1+$/u.test(word)));
}

function negatedMention(text:string,index:number):boolean{
 const before=normalizeVocabularyText(text).slice(Math.max(0,index-48),index);
 return /(?:^|[^\p{L}])(?:не|без|not|no)\s+(?:(?:a|the|игра|делай|создавай|создай|хочу|нужен|нужна|делать)\s+){0,2}$/u.test(before);
}
function vocabularyHits<T extends {id:string;aliases:readonly string[];source?:'EXPLICIT'|'INFERRED'}>(text:string,terms:readonly T[],source:IntentSource='EXPLICIT'){
 const found:{index:number;requirement:Requirement<string>}[]=[];
 for(const term of terms){
  const match=vocabularyOccurrences(text,term.aliases).find(item=>!negatedMention(text,item.index));
  if(!match)continue;
  const before=normalizeVocabularyText(text).slice(Math.max(0,match.index-36),match.index);
  if(/(?:название|называется|title|is called)\s*$/u.test(before))continue;
  found.push({index:match.index,requirement:fact(term.id,match.evidence,term.source??source)});
 }
 const seen=new Set<string>();return found.sort((a,b)=>a.index-b.index).flatMap(item=>{const id=item.requirement.value!;if(seen.has(id))return[];seen.add(id);return[item.requirement];});
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
  const explicitGenres = vocabularyHits(text, genreWords);
  const archetypes=vocabularyHits(text,GAME_VOCABULARY,'INFERRED');
  const archetypeDefinitions=archetypes.flatMap(match=>{const item=GAME_VOCABULARY.find(entry=>entry.id===match.value);return item?[item]:[];});
  const inferredGenres=[...new Set(archetypeDefinitions.map(item=>item.genre))].map(value=>fact(value,archetypeDefinitions.filter(item=>item.genre===value).map(item=>archetypes.find(match=>match.value===item.id)?.evidence??item.id).join('; '),'INFERRED'));
  const genre = explicitGenres.length ? one(explicitGenres) : one(inferredGenres);
  const audienceMatches=vocabularyHits(text,audienceWords);
  let audience = one(audienceMatches.map(match=>match.value==='elderly'?fact(match.value!,match.evidence!,'INFERRED'):match));
  const childAge = text.match(/для\s+(?:сына|дочери)\s+(\d{1,2})\s+лет/iu);
  if (!audience.value && childAge && Number(childAge[1]) < 18) audience = fact('kids', childAge[0], 'INFERRED');
  const actions = hits(text, actionWords);
  // Negative requirements use their own label and keep the explicit negation.
  const negatives = hits(text, explicitMechanics.filter(([label]) => label.startsWith('no_') || label === 'endless_play'));
  const positiveMechanics = [...actions, ...vocabularyHits(text,GAME_MECHANICS), ...hits(text, explicitMechanics.filter(([label]) => !label.startsWith('no_') && label !== 'endless_play'))];
  const constraints=vocabularyHits(text,GAME_CONSTRAINTS);
  const constraintSuppressions:Record<string,readonly string[]>={no_food:['food_collection','growth','catching','falling_objects'],no_growth:['growth'],no_score:['score'],no_loss:['snake_collision'],no_rotation:['piece_rotation'],no_enemies:['enemy_path','range_attack'],no_lives:['lives'],no_jumping:['jumping'],no_shooting:['shooting'],no_movement:['movement','steering','snake_movement','vehicle_motion','player_position','ship_movement'],no_collection:['collection','food_collection','catching','falling_objects'],no_matching:['matching','clear_matches','pair_match']};
  const suppressedMechanics=new Set(constraints.flatMap(rule=>constraintSuppressions[rule.value??'']??[]));
  const archetypeMechanics=archetypeDefinitions.flatMap(item=>item.mechanics.filter(value=>!suppressedMechanics.has(value)).map(value=>fact(value,archetypes.find(match=>match.value===item.id)?.evidence??item.id,'INFERRED')));
  const mechanics = [...positiveMechanics, ...negatives, ...archetypeMechanics, ...hits(text, inferredMechanics, 'INFERRED')
    .filter(r => !positiveMechanics.some(a => a.value === r.value) && !archetypeMechanics.some(a=>a.value===r.value) && !forbiddenInference[r.value!]?.test(text))]
    .filter((r,index,all)=>all.findIndex(x=>x.value===r.value)===index && !forbiddenInference[r.value!]?.test(text));
  const win = safeClauses.filter(s => /побед|победить|выигр/iu.test(withoutQuotes(s))).map(s => fact(s, s));
  const loss = safeClauses.filter(s => /проигр|поражен|поражён|поражени/iu.test(withoutQuotes(s))).map(s => fact(s, s));
  const controls = safeClauses.filter(s => /пальц|тап|нажима|управлен|стрелк|клави|кнопк|мыш[ьи]/iu.test(withoutQuotes(s))).map(s => fact(s, s));
  const presentationClauses=safeClauses.filter(s=>/оформлен|цвет|фон|пиксел|неон|крупн|звук|без\s+спешки|спокойн/iu.test(withoutQuotes(s))).map(s=>fact(s,s));
  const presentation = [...presentationClauses,...vocabularyHits(text,GAME_PRESENTATION).filter(match=>!presentationClauses.some(clause=>clause.value===match.evidence))];
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
  if (!originalRequest.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(originalRequest) || originalRequest.length > 1200) inputStatus = fact('invalid', 'Empty, oversized or invalid control characters');
  else if (obviousFiller(originalRequest)) inputStatus = fact('invalid', 'Symbol-only input or corroborated placeholder sequence');
  else if (unsafeMatch) inputStatus = fact('unsafe_instruction', unsafeMatch[0]);
  else if (conflicts.length) inputStatus = fact('needs_clarification', conflicts.map(c => c.evidence).join('; '));
  else if (/^\s*(?:подскажи|дай|напиши)\s+рецепт(?![\p{L}])/iu.test(text)) inputStatus = fact('off_topic', originalRequest);
  else if (genre.value || actions.length || /игр[ауы]|что-нибудь|про\s+[\p{L}]/iu.test(text)) inputStatus = fact('valid', originalRequest, 'INFERRED');
  return { originalRequest, idea: originalRequest.trim() ? fact(originalRequest, originalRequest) : unknown(), genre, archetypes, audience,
    entities: hits(text, entityWords), actions, mechanics, numbers, win, loss, controls, presentation, constraints,
    requirements: clauses.map(s => fact(s, s)), conflicts, inputStatus };
}

/** Wire projection only: rules/numbers/bans stay verbatim in request, once.
 * Detailed facts and evidence remain available internally through gameIntent.
 */
export function compactGameIntent(intent: GameIntent) {
  const groups: Partial<Record<'EXPLICIT' | 'INFERRED', { genre?: string; archetypes?:string[]; audience?: string; mechanics?: string[]; constraints?:string[] }>> = {};
  const seenMechanics = new Set<string>();
  for (const source of ['EXPLICIT', 'INFERRED'] as const) {
    const group: { genre?: string; archetypes?:string[]; audience?: string; mechanics?: string[]; constraints?:string[] } = {};
    for (const key of ['genre', 'audience'] as const) {
      const requirement = intent[key];
      if (requirement.source === source && requirement.value !== null) group[key] = requirement.value;
    }
    const archetypes=intent.archetypes.filter(requirement=>requirement.source===source&&requirement.value!==null).map(requirement=>requirement.value!);
    if(archetypes.length)group.archetypes=archetypes;
    const constraints=intent.constraints.filter(requirement=>requirement.source===source&&requirement.value!==null).map(requirement=>requirement.value!);
    if(constraints.length)group.constraints=constraints;
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

const mechanicText: Record<string, string> = {
  snake_movement: 'move a grid-based snake in four directions',
  food_collection: 'place food and collect it', growth: 'grow the snake after food is collected',
  snake_collision: 'handle wall and self-collision consistently with the requested loss rules',
  score: 'show a simple food count',
  falling_blocks: 'drop controllable falling blocks onto a board', line_clear: 'clear completed rows and compact the board',
  piece_rotation: 'let the player rotate pieces when the request allows it',
  running: 'move the player forward through a scrolling course', obstacle_avoidance: 'let the player avoid course obstacles',
  clicking: 'make each deliberate tap change the game state',
  steering:'steer the vehicle with responsive controls', vehicle_motion:'make vehicle input change its position',track_collision:'keep track boundaries meaningful',
  paddle_control:'move the paddle with player input',ball_bounce:'make ball rebounds follow visible collisions',brick_collision:'remove or react to bricks only on collision',
  grid_navigation:'move between valid neighboring grid cells',pathfinding:'make reachable paths and blocked cells clear',maze_exit:'provide a destination only when requested',
  box_pushing:'push boxes with grid-aligned movement',goal_tiles:'use target cells only where the request calls for them',matching:'update the board after a valid match',
  swap_adjacent:'allow only legal adjacent swaps',clear_matches:'remove valid matches and settle the board',grid_reveal:'reveal cells in response to input',mine_flagging:'let the player mark suspected hazards',
  adjacent_mine_counts:'show counts based on neighboring cells',catching:'move the catcher to collect requested items',falling_objects:'make falling objects respond to game state',player_position:'map touch and keyboard input to player position',
  ship_movement:'move the ship from direct input',shooting:'fire only when shooting is requested',projectile_collision:'resolve projectile hits visibly',
  tower_placement:'place structures only on valid locations',enemy_path:'use an enemy route only if enemies are requested',range_attack:'resolve attacks within visible range',
  incremental_progress:'show relevant progress after deliberate actions',passive_progress:'advance in real time only when idle progress is requested',
  hidden_pairs:'keep paired items hidden until selected',reveal_pair:'reveal one selected item at a time',pair_match:'compare selected pairs and update state',
  beat_timing:'synchronize player actions to visible beats',note_input:'make note input affect the rhythm state',word_building:'form words according to stated rules',letter_selection:'make selected letters visible and editable',
  question_answer:'accept an answer to each presented question',answer_feedback:'show whether the selected answer matches',flipper_control:'make flippers respond to player input',ball_physics:'make ball motion and rebounds consistent',bumpers:'show ball response to bumper collisions',
  tap_lift:'make each tap control lift',gravity:'apply consistent downward acceleration',puzzle_action:'provide a valid action that changes the puzzle',state_change:'redraw after a valid move',
  survival:'use survival pressure only when requested',resource_management:'track resources only when the idea requires them',grid_turns:'alternate valid turns',place_marker:'place a marker in a free cell',line_win:'detect a completed line or draw',
};

/** Short, single-pass game archetype hints. The raw request always wins. */
export function inferredGameBrief(intent: GameIntent): string | null {
  const values=intent.mechanics.filter(x=>x.source==='INFERRED'&&x.value&&mechanicText[x.value]).map(x=>x.value!);
  const selected=intent.archetypes.flatMap(match=>GAME_VOCABULARY.filter(item=>item.id===match.value));
  const details:string[]=[];
  for(const item of selected){
    if(item.id==='snake'){
      const parts=['start and restart'];if(values.includes('snake_movement'))parts.push('continuous grid movement');if(values.includes('food_collection'))parts.push('food collection');if(values.includes('growth'))parts.push('growth after eating');if(values.includes('snake_collision')&&!intent.mechanics.some(x=>x.value==='no_loss'))parts.push('collision and loss only if compatible with explicit rules');if(values.includes('score'))parts.push('visible food count');
      details.push('Classic Snake loop: '+parts.join(', ')+'.');
    }else if(item.id==='falling_blocks'){
      const actions=['move and place blocks'];if(values.includes('piece_rotation'))actions.push('rotate pieces');details.push('Tetris loop: falling tetrominoes, '+actions.join(', ')+', completed rows disappear, the board updates after each placement, and restart; do not invent a score target or forced victory.');
    }else if(item.id==='racing')details.push('Racing loop: steer and control speed on a readable course, show the vehicle and track clearly, and make each input affect motion; add laps, timer, score or finish rules only when requested or clearly implied.');
    else if(item.id==='puzzle')details.push('Puzzle loop: present a legible board and a real player action that changes its state, show relevant progress, and provide a way to retry; do not assume a matching rule, timer, score or win condition absent from the request.');
    else details.push(item.description);
  }
  if(intent.archetypes.length>1)details.push('The user named multiple game ideas; preserve each one and combine them without dropping its core rules.');
  if(!selected.length&&values.length)details.push(values.map(x=>mechanicText[x]).join('; ')+'.');
  if(intent.audience.value==='elderly')details.push('For an older player: calm pacing, large high-contrast elements and labels, clear instructions, and large touch targets; do not assume medical needs.');
  return details.length?details.join(' '):null;
}

export function gameIntentDiagnostics(intent:GameIntent,extraHint:string,classificationMs:number){
 const suppressions:Record<string,readonly string[]>={no_food:['food_collection','growth','catching','falling_objects'],no_growth:['growth'],no_score:['score'],no_loss:['snake_collision'],no_rotation:['piece_rotation'],no_enemies:['enemy_path','range_attack'],no_lives:['lives'],no_jumping:['jumping'],no_shooting:['shooting'],no_movement:['movement','steering','snake_movement','vehicle_motion','player_position','ship_movement'],no_collection:['collection','food_collection','catching','falling_objects'],no_matching:['matching','clear_matches','pair_match']};
 const possible=new Set(intent.archetypes.flatMap(match=>GAME_VOCABULARY.find(item=>item.id===match.value)?.mechanics??[]));
 const suppressedAssumptionCount=intent.constraints.reduce((count,rule)=>count+(suppressions[rule.value??'']??[]).filter(mechanic=>possible.has(mechanic)).length,0);
 const appliedRules=new Set([...intent.archetypes.map(x=>'archetype:'+x.value),...(intent.genre.value?['genre:'+intent.genre.value]:[]),...(intent.audience.value?['audience:'+intent.audience.value]:[]),...intent.mechanics.filter(x=>x.value&&!/^no_/.test(x.value)).map(x=>'mechanic:'+x.value),...intent.presentation.map(x=>'presentation:'+x.value),...intent.constraints.map(x=>'constraint:'+x.value)]);
 return {vocabularyVersion:VOCABULARY_VERSION,archetypeId:intent.archetypes.map(x=>x.value).filter((x):x is string=>Boolean(x)).join('-and-')||null,genreId:intent.genre.value??'UNKNOWN',
  appliedRuleCount:appliedRules.size,
  ruleSources:[...new Set([...intent.archetypes,intent.genre,intent.audience,...intent.mechanics,...intent.presentation,...intent.constraints].map(x=>x.source).filter(x=>x==='EXPLICIT'||x==='INFERRED'))],
  suppressedAssumptionCount,
  hintBytes:Buffer.byteLength(extraHint),classificationMs:Math.max(0,classificationMs)};
}

export const intentDefaults: Requirement<string>[] = [
  fact('Provide a clear start, explain the actual controls, and make each essential action work.', 'Product gameplay contract', 'DEFAULT'),
  fact('Implement a real repeatable gameplay loop with visible relevant progress; do not force a score into a no-score game.', 'Product gameplay contract', 'DEFAULT'),
  fact('Provide a correct restart to a fresh run. Add win/loss only where appropriate and compatible with explicit rules; do not force a terminal state into endless/no-loss play.', 'Product gameplay contract', 'DEFAULT'),
  fact('Unknown details are not requirements. Choose only minimal implementation details consistent with the verbatim request; do not invent a story, enemies, lives, pickups or numeric goals.', 'Conservative intent policy', 'DEFAULT'),
  fact('Return one standalone offline HTML5 document with inline CSS/JS. Support 320px mobile screens, touch for all essential actions, rotation/safe areas and desktop input; no external resources or networking.', 'Product mobile/offline contract', 'DEFAULT'),
];
