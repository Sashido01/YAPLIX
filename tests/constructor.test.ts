import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintSchema, parseBlueprint, validateSchema } from '../src/research/constructor/blueprint.ts';
import { compileBlueprint } from '../src/research/constructor/compiler.ts';
import { cleanHouse, fixtures, matchThree, jungleRace } from '../src/research/constructor/fixtures.ts';
import { validateDocument } from '../src/generation.ts';
import { GAME_CSP } from '../src/runtime.ts';

test('constructor: all authored fixtures validate and compile standalone without changing inputs', () => {
  for (const b of Object.values(fixtures)) {
    const before = JSON.stringify(b);
    validateSchema(blueprintSchema, b);
    const result = compileBlueprint(b);
    assert.equal(JSON.stringify(b), before);
    assert.deepEqual(validateDocument(result.html), []);
    assert.ok(result.html.includes(GAME_CSP));
    assert.ok(result.html.includes('data:image/svg+xml,'));
    assert.ok(result.metrics.htmlBytes < 30000);
    assert.ok(!/src="https?:|import\(|eval\(|new Function/.test(result.html));
  }
});
test('constructor: corrupt JSON shape, unknown components/keys, size and schema bounds fail closed', () => {
  for (const value of [null, {}, { ...cleanHouse, version: 2 }, { ...cleanHouse, secret: 'x' }, { ...cleanHouse, components: ['unknown'] }, { ...cleanHouse, components: ['move', 'move'] }, { ...cleanHouse, logic: 'x'.repeat(24001) }, { ...cleanHouse, world: { ...cleanHouse.world, cols: 0 } }]) assert.throws(() => parseBlueprint(value), /BLUEPRINT/);
});
test('constructor: incompatible components, conflicting deadlines and malformed board fail', () => {
  const cases = [
    { ...cleanHouse, components: ['move', 'chase', 'scroll', 'collect'] },
    { ...matchThree, components: ['match3', 'move'] },
    { ...matchThree, board: undefined },
    { ...matchThree, board: { colors: 3, cells: [0] } },
    { ...jungleRace, rules: { ...jungleRace.rules, win: { metric: 'elapsed', atLeast: 15 } } },
    { ...cleanHouse, rules: { ...cleanHouse.rules, win: { metric: 'collected', atLeast: 3 } } },
    { ...cleanHouse, player: { x: 3, y: 0, health: 2 } },
    { ...cleanHouse, entities: [cleanHouse.entities[0], cleanHouse.entities[0]] },
  ];
  cases.forEach(b => assert.throws(() => parseBlueprint(b), /BLUEPRINT/));
});
test('constructor: generated JS is syntax parsed, never evaluated on Node; script escapes and forbidden execution rejected', () => {
  for (const logic of ['api.on(', '</script><script>alert(1)', 'fetch("https://example.invalid")', 'new Function("return 1")', 'import("x")', 'require("node:fs")']) assert.throws(() => compileBlueprint({ ...cleanHouse, logic }));
  // If compilation executed this throw, the test would fail.
  assert.doesNotThrow(() => compileBlueprint({ ...cleanHouse, logic: 'throw new Error("browser-only");' }));
});
test('constructor: parameter, theme and component changes preserve extension module contract', () => {
  const original = compileBlueprint(cleanHouse), themed = compileBlueprint({ ...cleanHouse, theme: 'pixel-test' });
  assert.notEqual(original.html, themed.html);
  assert.equal(original.metrics.logicBytes, themed.metrics.logicBytes);
  assert.ok(compileBlueprint(fixtures.variant).html.includes('recycling-token'));
});
