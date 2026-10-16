// MICRO-026 research only. No production imports this module.
export interface Entity {
  id: string; kind: 'item' | 'enemy' | 'obstacle'; x: number; y: number;
  value: number; damage: number; behavior: 'still' | 'chase' | 'scroll';
}
export interface GameBlueprint {
  version: 1; title: string; family: 'topdown' | 'board' | 'racer';
  scenes: ['play']; components: ('move' | 'collect' | 'chase' | 'scroll' | 'match3')[];
  world: { cols: number; rows: number; walls: number[] };
  player: { x: number; y: number; health: number };
  entities: Entity[];
  rules: { win: { metric: 'score' | 'collected' | 'elapsed'; atLeast: number }; loss: { seconds: number; moves: number } };
  theme: 'neon-test' | 'pixel-test';
  board?: { colors: number; cells: number[] };
  logic: string;
}

type Schema = { type?: string; const?: unknown; enum?: unknown[]; minimum?: number; maximum?: number; minLength?: number; maxLength?: number; pattern?: string; minItems?: number; maxItems?: number; uniqueItems?: boolean; items?: Schema; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: false };
const integer = (minimum: number, maximum: number): Schema => ({ type: 'integer', minimum, maximum });
const text = (maxLength: number): Schema => ({ type: 'string', maxLength });
const list = (items: Schema, maxItems: number, minItems = 0): Schema => ({ type: 'array', items, minItems, maxItems });
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: 'object', properties, required, additionalProperties: false });
const choice = (...values: string[]): Schema => ({ type: 'string', enum: values });
export const entitySchema = object({ id: { ...text(32), minLength: 1, pattern: '^[a-z][a-z0-9-]*$' }, kind: choice('item', 'enemy', 'obstacle'), x: integer(0, 11), y: integer(0, 11), value: integer(0, 100), damage: integer(0, 10), behavior: choice('still', 'chase', 'scroll') });
export const blueprintSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  ...object({
    version: { const: 1 }, title: { ...text(80), minLength: 1 }, family: choice('topdown', 'board', 'racer'),
    scenes: { ...list({ const: 'play' }, 1, 1), uniqueItems: true },
    components: { ...list(choice('move', 'collect', 'chase', 'scroll', 'match3'), 5, 1), uniqueItems: true },
    world: object({ cols: integer(4, 12), rows: integer(4, 12), walls: { ...list(integer(0, 143), 100), uniqueItems: true } }),
    player: object({ x: integer(0, 11), y: integer(0, 11), health: integer(1, 10) }),
    entities: list(entitySchema, 80),
    rules: object({ win: object({ metric: choice('score', 'collected', 'elapsed'), atLeast: integer(1, 10000) }), loss: object({ seconds: integer(1, 120), moves: integer(1, 200) }) }),
    theme: choice('neon-test', 'pixel-test'), board: object({ colors: integer(3, 6), cells: list(integer(0, 5), 144, 16) }), logic: text(8000),
  }, ['version', 'title', 'family', 'scenes', 'components', 'world', 'player', 'entities', 'rules', 'theme', 'logic']),
};

// Small fail-closed evaluator for precisely the schema vocabulary above. No
// coercion, remote refs, code generation or dependency installation.
export function validateSchema(schema: Schema, value: unknown, path = '$'): void {
  const fail = () => { throw new Error('BLUEPRINT_SCHEMA ' + path); };
  if ('const' in schema && value !== schema.const) fail();
  if (schema.enum && !schema.enum.includes(value)) fail();
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
    const data = value as Record<string, unknown>, props = schema.properties!;
    if (schema.required?.some(key => !Object.hasOwn(data, key))) fail();
    for (const key of Object.keys(data)) { if (!Object.hasOwn(props, key)) fail(); validateSchema(props[key], data[key], path + '.' + key); }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) return fail();
    if (value.length < (schema.minItems ?? 0) || value.length > schema.maxItems!) fail();
    if (schema.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) fail();
    value.forEach((v, i) => validateSchema(schema.items!, v, path + '[' + i + ']'));
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') return fail();
    if (value.length < (schema.minLength ?? 0) || value.length > schema.maxLength! || schema.pattern && !new RegExp(schema.pattern).test(value)) fail();
  } else if (schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < schema.minimum! || value > schema.maximum!) fail();
  }
}

export function parseBlueprint(input: unknown): GameBlueprint {
  // Accept JSON data only; clone it so later mutations cannot change a build.
  const bytes = JSON.stringify(input);
  if (!bytes || Buffer.byteLength(bytes) > 24000) throw new Error('BLUEPRINT_SIZE');
  const b = JSON.parse(bytes) as GameBlueprint;
  validateSchema(blueprintSchema, b);
  const has = (key: GameBlueprint['components'][number]) => b.components.includes(key);
  const fail = () => { throw new Error('BLUEPRINT_INCOMPATIBLE'); };
  if (has('match3') ? b.components.length !== 1 || !b.board || b.entities.length > 0 || b.world.walls.length > 0 || b.rules.win.metric !== 'score' : !has('move') || b.board !== undefined) fail();
  if (has('scroll') && has('chase')) fail();
  const valid = (e: { x: number; y: number }) => e.x < b.world.cols && e.y < b.world.rows && !b.world.walls.includes(e.y * b.world.cols + e.x);
  if (!valid(b.player) || b.world.walls.some(n => n >= b.world.cols * b.world.rows)) fail();
  if (new Set(b.entities.map(e => e.id)).size !== b.entities.length || b.entities.some(e => !valid(e) || e.behavior === 'chase' && !has('chase') || e.behavior === 'scroll' && !has('scroll') || e.kind === 'item' && !has('collect'))) fail();
  if (b.entities.some(e => e.x === b.player.x && e.y === b.player.y)) fail();
  if (b.board && (b.board.cells.length !== b.world.cols * b.world.rows || b.board.cells.some(n => n >= b.board!.colors))) fail();
  if (b.rules.win.metric === 'collected' && (has('match3') || !has('collect') || b.rules.win.atLeast > b.entities.filter(e => e.kind === 'item').length)) fail();
  if (b.rules.win.metric === 'elapsed' && b.rules.win.atLeast >= b.rules.loss.seconds) fail();
  return b;
}
