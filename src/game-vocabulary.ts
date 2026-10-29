/** Small, local hints for interpreting game requests. No text is fetched at runtime. */
export const VOCABULARY_VERSION='game-vocabulary-1';

export interface GameArchetype {
 id:string; genre:string; aliases:readonly string[]; mechanics:readonly string[];
 compatibleWith:readonly string[]; description:string;
}

export const GAME_VOCABULARY:readonly GameArchetype[]=[
 {id:'snake',genre:'arcade',aliases:['змейка','змейку','змейки','змейкой','snake','nokia snake'],mechanics:['snake_movement','food_collection','growth','snake_collision','score'],compatibleWith:['maze','survival','catching'],description:'Move a growing snake, collect food and handle collisions only when compatible with the requested rules.'},
 {id:'falling_blocks',genre:'puzzle',aliases:['тетрис','тетриса','тетрисом','tetris','falling blocks','падающие блоки','падение блоков'],mechanics:['falling_blocks','line_clear','piece_rotation'],compatibleWith:['puzzle','rhythm'],description:'Control falling blocks, place pieces and clear complete rows; do not invent a score target.'},
 {id:'brick_breaker',genre:'arcade',aliases:['арканоид','арканоида','арканоидом','arkanoid','брейкаут','breakout','brick breaker'],mechanics:['paddle_control','ball_bounce','brick_collision'],compatibleWith:['puzzle','survival'],description:'Move a paddle, bounce a ball and respond to brick collisions; add only requested goals.'},
 {id:'pong',genre:'arcade',aliases:['понг','pong','пинг понг','ping pong'],mechanics:['paddle_control','ball_bounce','opponent_or_wall'],compatibleWith:['racing','quiz'],description:'Use paddles and a moving ball; add an opponent or scoring rules only when requested or clearly implied.'},
 {id:'platformer',genre:'platformer',aliases:['платформер','платформера','платформером','platformer','platform game'],mechanics:['jumping','platform_movement','landing'],compatibleWith:['puzzle','survival','catching'],description:'Move and jump between platforms with collisions that match the requested level and goal.'},
 {id:'endless_runner',genre:'runner',aliases:['бесконечный раннер','бесконечного раннера','раннер','раннера','раннером','endless runner','runner'],mechanics:['running','obstacle_avoidance'],compatibleWith:['racing','catching','survival'],description:'Move through a scrolling course and respond to obstacles; avoid inventing a forced finish or score target.'},
 {id:'racing',genre:'racing',aliases:['гонки','гонку','гонок','гонка','racing','racing game','car racing'],mechanics:['steering','vehicle_motion','track_collision'],compatibleWith:['endless_runner','pong'],description:'Steer a vehicle on a readable course; add laps, timer, score or finish rules only when requested or clearly implied.'},
 {id:'maze',genre:'maze',aliases:['лабиринт','лабиринта','лабиринте','лабиринтом','maze'],mechanics:['grid_navigation','pathfinding','maze_exit'],compatibleWith:['snake','sokoban','survival','puzzle'],description:'Navigate a legible maze; use an exit or destination only if the request supports one.'},
 {id:'sokoban',genre:'puzzle',aliases:['сокобан','сокобана','сокобаном','sokoban','ящики толкать','толкать ящики'],mechanics:['grid_navigation','box_pushing','goal_tiles'],compatibleWith:['maze','puzzle'],description:'Move on a grid and push boxes without pulling; preserve reachable goals and allow a reset or undo if suitable.'},
 {id:'match_three',genre:'puzzle',aliases:['три в ряд','три-в-ряд','матч три','match 3','match-3','match three','match-three'],mechanics:['matching','swap_adjacent','clear_matches'],compatibleWith:['puzzle','word_game'],description:'Allow valid neighboring swaps and update the board when matching pieces are cleared; do not invent a timer or target.'},
 {id:'minesweeper',genre:'puzzle',aliases:['сапёр','сапера','сапёра','сапером','сапёром','sapper','minesweeper','mine sweeper'],mechanics:['grid_reveal','mine_flagging','adjacent_mine_counts'],compatibleWith:['puzzle','quiz'],description:'Reveal cells, use neighboring mine counts and provide flagging when appropriate; respect requested loss rules.'},
 {id:'catching',genre:'arcade',aliases:['лови звезды','лови звёзды','поймай звезды','поймай звёзды','ловля звезд','ловля звёзд','ловлю звезд','ловлю звёзд','ловить предметы','catch stars','catch falling stars','catch falling objects','catching game'],mechanics:['catching','falling_objects','player_position'],compatibleWith:['snake','endless_runner','platformer'],description:'Move a catcher and collect the requested falling objects; show only progress and consequences supported by the request.'},
 {id:'space_shooter',genre:'shooter',aliases:['космический шутер','космическая стрелялка','space shooter','space invaders'],mechanics:['ship_movement','shooting','projectile_collision'],compatibleWith:['survival','endless_runner'],description:'Control a ship and fire at targets only when requested; preserve explicit restrictions on shooting, enemies and lives.'},
 {id:'tower_defense',genre:'strategy',aliases:['башенная защита','защита башен','защита башни','защиты башен','с защитой башни','tower defense','tower defence'],mechanics:['tower_placement','enemy_path','range_attack'],compatibleWith:['survival','clicker'],description:'Place defensive structures and resolve their range against a route only if enemies and defense are part of the request.'},
 {id:'clicker',genre:'clicker',aliases:['кликер','кликера','кликером','clicker','clicker game','incremental clicker'],mechanics:['clicking','incremental_progress'],compatibleWith:['idle','tower_defense'],description:'Make each deliberate tap change state and show relevant progress; do not invent currencies or upgrades.'},
 {id:'idle',genre:'idle',aliases:['idle','idle game','айдел','инкрементальная игра'],mechanics:['passive_progress','incremental_progress'],compatibleWith:['clicker'],description:'Use passive progression only when requested or clearly implied; make controls and progress understandable.'},
 {id:'memory',genre:'puzzle',aliases:['мемори','игра мемори','найди пары','найти пары','memory game','memory match','memory matching','memory matching game','matching pairs','memory puzzle'],mechanics:['hidden_pairs','reveal_pair','pair_match'],compatibleWith:['puzzle','quiz'],description:'Reveal concealed items in pairs and show whether a pair matches; do not add a timer unless requested.'},
 {id:'rhythm',genre:'rhythm',aliases:['ритм игра','ритм-игра','ритм игру','ритм игры','ритмическая игра','rhythm game','rhythm'],mechanics:['beat_timing','note_input'],compatibleWith:['falling_blocks'],description:'Make input timing correspond to visible beats or notes; do not invent scoring thresholds or music assets.'},
 {id:'word_game',genre:'word_game',aliases:['игра в слова','игру в слова','игры в слова','словесная игра','слова из букв','word game','word puzzle'],mechanics:['word_building','letter_selection'],compatibleWith:['puzzle','match_three','quiz'],description:'Use letters and word rules explicitly supported by the request; leave vocabulary and goals open if unspecified.'},
 {id:'quiz',genre:'educational',aliases:['викторина','викторину','викторины','quiz','trivia','trivia game'],mechanics:['question_answer','answer_feedback'],compatibleWith:['word_game','memory','pong'],description:'Present answerable questions and clear feedback; do not assume subject, timer or score target.'},
 {id:'pinball',genre:'arcade',aliases:['пинбол','пинбола','пинболом','pinball'],mechanics:['flipper_control','ball_physics','bumpers'],compatibleWith:['brick_breaker'],description:'Control flippers and keep the ball in play with visible collisions; add scoring only if compatible with the request.'},
 {id:'flappy',genre:'arcade',aliases:['flappy bird','flappy','флаппи','флаппи берд'],mechanics:['tap_lift','gravity','obstacle_avoidance'],compatibleWith:['endless_runner'],description:'Use taps to control lift against gravity and navigate gaps; do not force a score or loss if prohibited.'},
 {id:'puzzle',genre:'puzzle',aliases:['головоломка','головоломку','головоломки','головоломкой','пазл','пазла','пазл игра','puzzle','puzzle game','logic puzzle'],mechanics:['puzzle_action','state_change'],compatibleWith:['maze','sokoban','match_three','minesweeper','memory','word_game','tic_tac_toe'],description:'Show a legible puzzle and a valid action that changes its state; do not assume a rule, timer, score or win condition.'},
 {id:'survival',genre:'survival',aliases:['выживание','выживания','выживании','игра на выживание','survival','survival game'],mechanics:['survival','resource_management'],compatibleWith:['snake','platformer','space_shooter','tower_defense','maze'],description:'Use survival pressure only as requested; do not invent health, enemies or a timer.'},
 {id:'tic_tac_toe',genre:'puzzle',aliases:['крестики-нолики','крестики нолики','нолики-крестики','tic-tac-toe','tic tac toe','noughts and crosses'],mechanics:['grid_turns','place_marker','line_win'],compatibleWith:['puzzle'],description:'Alternate valid marker placements and detect a completed line or draw; support the requested number of players.'},
];

export interface VocabularyTerm {id:string;aliases:readonly string[];source?:'EXPLICIT'|'INFERRED'}
export const GAME_GENRES:readonly VocabularyTerm[]=[
 {id:'maze',aliases:['лабиринт','maze']},{id:'arcade',aliases:['аркада','аркаду','аркадная игра','arcade']},{id:'action',aliases:['экшен','action game']},
 {id:'adventure',aliases:['приключение','приключенческая игра','adventure']},{id:'puzzle',aliases:['головоломка','пазл','puzzle']},
 {id:'platformer',aliases:['платформер','platformer']},{id:'runner',aliases:['раннер','runner']},{id:'racing',aliases:['гонки','racing']},
 {id:'shooter',aliases:['шутер','стрелялка','shooter']},{id:'strategy',aliases:['стратегия','strategy']},{id:'simulation',aliases:['симулятор','simulation']},
 {id:'sports',aliases:['спортивная игра','sports game']},{id:'survival',aliases:['выживание','survival']},{id:'rhythm',aliases:['ритм игра','rhythm game']},
 {id:'word_game',aliases:['словесная игра','игра в слова','word game']},{id:'word_puzzle',aliases:['word puzzle','слова из букв','складывать слова из букв'],source:'INFERRED'},{id:'educational',aliases:['обучающая игра','educational game']},
 {id:'clicker',aliases:['кликер','clicker']},{id:'idle',aliases:['idle game','idle']},{id:'casual',aliases:['казуальная игра','casual game']},
 {id:'roguelike',aliases:['рогалик','roguelike']},{id:'card',aliases:['карточная игра','card game']},
];
export const GAME_AUDIENCES:readonly VocabularyTerm[]=[
 {id:'kids',aliases:['для детей','для ребенка','для ребёнка','детская игра','for kids']},
 {id:'elderly',aliases:['для бабушки','для бабушек','для дедушки','для дедушек','для пожилых','для пожилого игрока','для пенсионеров','for seniors','for grandma','for granny','for grandpa','for granddad']},
 {id:'family',aliases:['для всей семьи','для семьи','family game']},{id:'hardcore',aliases:['хардкорная','хардкорный','hardcore']},
 {id:'default',aliases:['для всех возрастов','для всех','all ages']},
];
export const GAME_PRESENTATION:readonly VocabularyTerm[]=[
 {id:'large_text',aliases:['крупный текст','крупные буквы','large text']},{id:'high_contrast',aliases:['контрастные цвета','высокий контраст','high contrast']},
 {id:'pixel_art',aliases:['пиксельная графика','пиксель арт','pixel art']},{id:'neon',aliases:['неоновый','неоновая','neon']},
 {id:'calm',aliases:['спокойная','спокойный темп','без спешки','calm pace']},{id:'sound_off',aliases:['без звука','звук выключен','no sound']},
];
export const GAME_CONSTRAINTS:readonly VocabularyTerm[]=[
 {id:'no_timer',aliases:['без таймера','без времени','без очков и таймера','без очков и без таймера','no timer','without a timer','without timer']},{id:'no_score',aliases:['без очков','без счета','без счёта','без очков и таймера','без очков и без таймера','no score','without score','without scoring']},
 {id:'no_loss',aliases:['без поражения','без проигрыша','нельзя проиграть','no loss','without losing','without loss']},{id:'no_food',aliases:['без еды','без еды и роста','без еды и без роста','без еды для змейки','without food','without food or growth']},
 {id:'no_growth',aliases:['без роста','без еды и роста','без еды и без роста','не расти','without growth','without food or growth']},{id:'no_enemies',aliases:['без врагов','без противников','no enemies','without enemies']},
 {id:'no_lives',aliases:['без жизней','no lives','without lives']},{id:'no_rotation',aliases:['без вращения','без поворотов','no rotation','without rotation']},
 {id:'no_jumping',aliases:['без прыжков','не прыгать','не прыгаем','no jumping','without jumping']},{id:'no_shooting',aliases:['без стрельбы','не стрелять','no shooting','without shooting']},
 {id:'no_movement',aliases:['без движения','не двигаться','no movement']},{id:'no_collection',aliases:['без сбора предметов','не собирать предметы','no collecting','without collecting']},
 {id:'no_matching',aliases:['без совпадений','не сопоставлять','no matching']},
];
export const GAME_MECHANICS:readonly VocabularyTerm[]=[
 {id:'growth',aliases:['рост','расти','растет','растёт','grow','growth']},
 {id:'jumping',aliases:['прыжок','прыгать','прыгает','jump','jumping']},{id:'movement',aliases:['движение','двигаться','управлять движением','movement']},
 {id:'collection',aliases:['собирать предметы','сбор предметов','collect items','collection']},{id:'shooting',aliases:['стрельба','стрелять','shooting','shoot']},
 {id:'dodging',aliases:['уворачиваться','уклоняться','dodge','dodging']},{id:'matching',aliases:['совпадения','сопоставление','matching']},
 {id:'building',aliases:['строительство','строить','building']},{id:'crafting',aliases:['крафтинг','создание предметов','crafting']},
 {id:'exploration',aliases:['исследование мира','исследовать мир','exploration']},{id:'resource_management',aliases:['управление ресурсами','resource management']},
 {id:'turn_based',aliases:['пошаговая игра','пошаговый режим','turn based','turn-based']},{id:'cooperative_play',aliases:['кооперативная игра','кооператив','co-op','cooperative']},
 {id:'competitive_play',aliases:['соревновательная игра','versus','competitive']},{id:'timed_challenge',aliases:['на время','timed challenge']},
 {id:'level_progression',aliases:['уровни сложности','прогрессия уровней','level progression']},
];

export const escapeRegex=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const aliasRegex=new Map<string,RegExp>();
/** NFC and case normalization only. Ё/e is the single deliberate Russian spelling fold. */
function normalizedWithSource(value:string){
 let text='',sourceStart:number[]=[],sourceEnd:number[]=[],cluster='',clusterStart=0,offset=0;
 const flush=()=>{if(!cluster)return;const normalized=cluster.normalize('NFC').toLowerCase().replaceAll('ё','е').replace(/[‐‑‒–—]/gu,'-');text+=normalized;for(let i=0;i<normalized.length;i++){sourceStart.push(clusterStart);sourceEnd.push(offset);}cluster='';};
 for(const char of value){const size=char.length,isMark=/^\p{M}$/u.test(char);if(!isMark&&cluster)flush();if(!cluster)clusterStart=offset;cluster+=char;offset+=size;}
 flush();return {text,sourceStart,sourceEnd};
}
export function normalizeVocabularyText(value:string):string{return normalizedWithSource(value).text;}
export function vocabularyOccurrences(text:string,aliases:readonly string[]):{alias:string;index:number;evidence:string}[]{
 const mapped=normalizedWithSource(text),normalized=mapped.text,found:{alias:string;index:number;evidence:string}[]=[];
 for(const alias of aliases){
  let regex=aliasRegex.get(alias);
  if(!regex){const value=normalizeVocabularyText(alias),pattern=value.split(' ').map(escapeRegex).join('\\s+');regex=new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`,'gu');aliasRegex.set(alias,regex);}
  regex.lastIndex=0;let match:RegExpExecArray|null;
  while((match=regex.exec(normalized))){const start=mapped.sourceStart[match.index],end=mapped.sourceEnd[match.index+match[0].length-1];if(start!==undefined&&end!==undefined)found.push({alias,index:match.index,evidence:text.slice(start,end)});}
 }
 return found;
}
export function vocabularyMatches(text:string,aliases:readonly string[]):string[]{return [...new Set(vocabularyOccurrences(text,aliases).map(x=>x.alias))];}
