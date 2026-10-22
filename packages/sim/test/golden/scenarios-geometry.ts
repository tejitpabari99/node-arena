import { computeSimHash } from '../../../content/src/index.js';
import type { Scenario } from './scenarios.js';
import { buildLevel } from './levels.js';
const draw = (tick: number, player: number, from: number, to: number): Scenario['commands'][number] => ({ tick, cmd: { type: 'DrawLine', player, from, to } });
const crossing = buildLevel('golden-geometry-crossing', [
  { at: [-10, 0], owner: 0, level: 64 }, { at: [0, -10], owner: 1, level: 64 },
  { at: [10, 0], owner: null, level: 20 }, { at: [0, 10], owner: null, level: 20 },
  { at: [3, 3], owner: null, level: 30, arch: 'tower' },
]);
const blocked = buildLevel('golden-geometry-obstacle', [
  { at: [0, 0], owner: 0, level: 64 }, { at: [10, 0], owner: 1, level: 64 },
  { at: [0, 10], owner: null, level: 20 }, { at: [5, 5], owner: null, level: 20 },
  { at: [10, 10], owner: null, level: 20, arch: 'tower' },
]);
blocked.elements.push({ id: 'rock', archetype: 'obstacle', x: 5000, z: 0, yawMilliDeg: 45000,
  footprint: { shape: 'box', w: 1000, d: 2000 }, visual: 'rock', modules: { blocksLines: {} } });
blocked.simHash = computeSimHash(blocked);
export const geometryScenarios: Scenario[] = [
  { name: 'geometry-neutral-troop', purpose: 'Default neutral tower shoots non-neutral passing troops.', fullGame: false,
    level: buildLevel('golden-neutral-troop', [
      { at: [-10, 2], owner: 0, level: 64 }, { at: [10, 2], owner: 1, level: 64 },
      { at: [0, 0], owner: null, level: 30, arch: 'tower' },
    ]), seed: 17, ticks: 100, commands: [draw(0, 0, 0, 1)] },
  { name: 'geometry-neutral-house', purpose: 'Default owned tower hits a neutral house, floors at zero without capture.', fullGame: false,
    level: buildLevel('golden-neutral-house', [
      { at: [0, 0], owner: 0, level: 1, arch: 'tower' }, { at: [3, 0], owner: null, level: 2 },
      { at: [20, 20], owner: 1, level: 1 },
    ]), seed: 17, ticks: 100, commands: [] },
  { name: 'geometry-crossing-cut', purpose: 'Crossing combat and neutral shooter; cut in-flight line, redraw rebuilds active caches.',
    fullGame: false, level: crossing, seed: 77, ticks: 140,
    commands: [draw(0, 0, 0, 2), draw(0, 1, 1, 3), { tick: 65, cmd: { type: 'CutLine', player: 0, from: 0, to: 2 } }, draw(90, 0, 0, 2)] },
  { name: 'geometry-obstacle-building', purpose: 'Rotated obstacle and third house/tower block; endpoint houses exempt on legal route.',
    fullGame: false, level: blocked, seed: 17, ticks: 80,
    commands: [draw(0, 0, 0, 1), draw(1, 0, 0, 4), draw(2, 0, 0, 2), draw(3, 0, 2, 4)] },
];
