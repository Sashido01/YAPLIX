import type { GameBlueprint } from './blueprint.ts';

// Authored offline inputs imitating possible model responses. Never LLM proof.
export const cleanHouse: GameBlueprint = {
  version: 1, title: 'Чистый дом', family: 'topdown', scenes: ['play'],
  components: ['move', 'collect', 'chase'],
  world: { cols: 6, rows: 6, walls: [3, 9, 21, 27, 33] },
  player: { x: 0, y: 0, health: 2 },
  entities: [
    { id: 'paper', kind: 'item', x: 1, y: 0, value: 1, damage: 0, behavior: 'still' },
    { id: 'bottle', kind: 'item', x: 4, y: 0, value: 1, damage: 0, behavior: 'still' },
    { id: 'bug', kind: 'enemy', x: 5, y: 5, value: 0, damage: 2, behavior: 'chase' },
  ],
  rules: { win: { metric: 'collected', atLeast: 2 }, loss: { seconds: 30, moves: 100 } },
  theme: 'neon-test',
  logic: "api.on('collect',()=>{if(api.state().collected===2)api.score(5);});",
};
export const matchThree: GameBlueprint = {
  version: 1, title: 'Три в ряд', family: 'board', scenes: ['play'], components: ['match3'],
  world: { cols: 4, rows: 4, walls: [] }, player: { x: 0, y: 0, health: 1 }, entities: [],
  rules: { win: { metric: 'score', atLeast: 30 }, loss: { seconds: 45, moves: 3 } }, theme: 'pixel-test',
  board: { colors: 3, cells: [0, 1, 0, 2, 1, 0, 2, 1, 2, 0, 1, 2, 0, 2, 1, 0] },
  logic: "api.on('match',e=>{if(e.count>=4)api.score(e.count);});",
};
export const jungleRace: GameBlueprint = {
  version: 1, title: 'Автогонки в джунглях', family: 'racer', scenes: ['play'], components: ['move', 'collect', 'scroll'],
  world: { cols: 6, rows: 6, walls: [0, 6, 12, 18, 24, 30, 5, 11, 17, 23, 29, 35] },
  player: { x: 2, y: 5, health: 2 },
  entities: [
    { id: 'rock', kind: 'obstacle', x: 2, y: 3, value: 0, damage: 2, behavior: 'scroll' },
    { id: 'fruit', kind: 'item', x: 1, y: 4, value: 10, damage: 0, behavior: 'scroll' },
    { id: 'tree', kind: 'obstacle', x: 4, y: 1, value: 0, damage: 1, behavior: 'scroll' },
  ],
  rules: { win: { metric: 'elapsed', atLeast: 4 }, loss: { seconds: 15, moves: 100 } }, theme: 'neon-test',
  logic: "let n=0;api.on('start',()=>{n=0;});api.on('collect',()=>{n++;if(n%2===0)api.score(7);});",
};

export const houseVariant: GameBlueprint = {
  ...structuredClone(cleanHouse), title: 'Дом: ключ пробуждает охранника',
  world: { cols: 6, rows: 6, walls: [15, 21, 27, 33] },
  entities: [
    { id: 'key', kind: 'item', x: 1, y: 0, value: 1, damage: 0, behavior: 'still' },
    { id: 'paper', kind: 'item', x: 2, y: 0, value: 1, damage: 0, behavior: 'still' },
    { id: 'bottle', kind: 'item', x: 4, y: 0, value: 1, damage: 0, behavior: 'still' },
    { id: 'bug', kind: 'enemy', x: 5, y: 5, value: 0, damage: 2, behavior: 'still' },
  ],
  rules: { win: { metric: 'score', atLeast: 8 }, loss: { seconds: 30, moves: 100 } },
  // This is executable novel event behavior, not palette/number substitution:
  // collecting a key creates an object, changes enemy behavior and the goal.
  logic: `api.on('collect',e=>{if(e.id==='key'){
    api.spawn({id:'recycling-token',kind:'item',x:3,y:0,value:3,damage:0,behavior:'still'});
    api.behavior('bug','chase');api.animate('bug');api.goal('score',6);
  }});`,
};
export const fixtures = { house: cleanHouse, match3: matchThree, race: jungleRace, variant: houseVariant };
