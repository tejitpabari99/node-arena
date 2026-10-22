import type { CompiledLevel } from '@node-arena/content';
import type { Command } from '@node-arena/defs';
import { buildLevel, type B } from './levels.js';

export interface Scenario {
  name: string;
  purpose: string;
  fullGame: boolean;
  level: CompiledLevel;
  seed: number;
  ticks: number;
  /** `tick` is the sim tick BEFORE the step (the recorder stamp); the command acts in effective tick `tick + 1`. */
  commands: { tick: number; cmd: Command }[];
}

type Entry = Scenario['commands'][number];
/** Commands are written by EFFECTIVE tick (the tick whose phase 1 applies them). */
const draw = (eff: number, player: number, from: number, to: number): Entry => ({ tick: eff - 1, cmd: { type: 'DrawLine', player, from, to } });
const cut = (eff: number, player: number, from: number, to: number): Entry => ({ tick: eff - 1, cmd: { type: 'CutLine', player, from, to } });
const raw = (eff: number, cmd: unknown): Entry => ({ tick: eff - 1, cmd: cmd as Command });

function scenario(name: string, purpose: string, level: CompiledLevel, ticks: number, commands: Entry[] = [], fullGame = false, seed = 20261022): Scenario {
  return { name, purpose, fullGame, level, seed, ticks, commands };
}
const house = (x: number, z: number, owner: B['owner'], level: number, more: Partial<B> = {}): B => ({ at: [x, z], owner, level, ...more });
/** Never-touched hostile building so the match cannot end by accident. */
const bystander = (x: number, z: number): B => house(x, z, 1, 1);

// spawn-table: sources (L, lines) in rows 10 apart; targets 40 units east (lane 160 ticks, no arrivals in 100 ticks).
const SPAWN_ROWS: [number, number][] = [[1, 1], [10, 1], [30, 1], [64, 1], [10, 2], [30, 2], [64, 2], [30, 3], [64, 3]];
function spawnTable(): Scenario {
  const buildings: B[] = [], commands: Entry[] = [];
  const targets: number[][] = [];
  SPAWN_ROWS.forEach(([level, lines], row) => {
    buildings.push(house(0, row * 10, 0, level));
    targets[row] = [];
  });
  SPAWN_ROWS.forEach(([, lines], row) => {
    for (let k = 0; k < lines; k++) { targets[row]!.push(buildings.length); buildings.push(house(40, row * 10 + k * 2, null, 5)); }
  });
  buildings.push(bystander(0, -20));
  SPAWN_ROWS.forEach((_, row) => { for (const to of targets[row]!) commands.push(draw(1, 0, row, to)); });
  return scenario('spawn-table', 'Spawn period table: 1/2/3 lines x L=1/10/30/64; first departures at ceil(period/1000) ticks; E-SPAWN 18461/24000/20869 mt.',
    buildLevel('golden-spawn-table', buildings), 100, commands);
}

export const scenarios: Scenario[] = [
  spawnTable(),
  scenario('growth', 'Growth timers: L=1 fires at 64600 mt (tick 65), L=63 fires at 45560 mt (tick 46); no line, no growth debt.',
    buildLevel('golden-growth', [house(0, 0, 0, 1), house(0, 10, 0, 63), house(40, 0, null, 5), bystander(40, 20)]), 70),
  scenario('capture-exact-no-flip', 'One soldier on a level-1 neutral: level hits 0 but ownership does not flip (exact L).',
    buildLevel('golden-capture-exact', [house(0, 0, 0, 64), house(5, 0, null, 1), bystander(40, 20)]), 50,
    [draw(1, 0, 0, 1), cut(15, 0, 0, 1)]),
  scenario('capture-flip-overshoot', 'L+1 soldiers flip a level-1 neutral; the flipped building starts at level 0 (overshoot discarded).',
    buildLevel('golden-capture-flip', [house(0, 0, 0, 64), house(5, 0, null, 1), bystander(40, 20)]), 60,
    [draw(1, 0, 0, 1), cut(28, 0, 0, 1)]),
  scenario('capture-kills-troops', 'Capture kills every troop sourced at the captured building: on its drawn line and on a line it cut earlier.',
    buildLevel('golden-capture-kills', [house(0, 0, 0, 64), house(10, 0, 1, 1), house(10, 40, null, 5), house(30, 0, null, 5)]), 72,
    [draw(1, 0, 0, 1), draw(1, 1, 1, 2), cut(25, 1, 1, 2), draw(26, 1, 1, 3), cut(28, 0, 0, 1)]),
  scenario('exchange-soldier-vs-tank', 'Head-on exchange: soldier dies, tank hp 2 -> 1; the damaged tank trades with the next soldier.',
    buildLevel('golden-exchange-st', [house(0, 0, 0, 64), house(10, 0, 1, 64, { tank: true })]), 70,
    [draw(1, 0, 0, 1), draw(1, 1, 1, 0)]),
  scenario('exchange-tank-vs-tank', 'Head-on tank vs tank (attack 2, hp 2): both die in one round.',
    buildLevel('golden-exchange-tt', [house(0, 0, 0, 64, { tank: true }), house(10, 0, 1, 64, { tank: true })]), 50,
    [draw(1, 0, 0, 1), draw(1, 1, 1, 0)]),
  scenario('reverse-replace', 'Drawing the reverse of an own line replaces it (cut reason replaced); in-flight troops keep flying.',
    buildLevel('golden-reverse-replace', [house(0, 0, 0, 20), house(10, 0, 0, 20), bystander(40, 20)]), 80,
    [draw(1, 0, 0, 1), draw(20, 0, 1, 0)]),
  scenario('no-auto-cut-level-drop', 'A hit drops stage 2 -> 1: both lines stay (free < 0), a new draw is rejected no-slot.',
    buildLevel('golden-no-auto-cut', [house(0, 0, 0, 10), house(5, 0, 1, 64), house(0, 40, null, 5), house(10, 40, null, 5), house(20, 40, null, 5)]), 60,
    [draw(1, 0, 0, 2), draw(1, 0, 0, 3), draw(1, 1, 1, 0), draw(40, 0, 0, 4)]),
  scenario('overflow-forward', 'Friendly arrival above max level: forwarded on a seeded drawn line (cause forward); no line = surplus lost.',
    buildLevel('golden-overflow-forward', [house(0, 0, 0, 64), house(5, 0, 0, 64), house(5, 10, 0, 64), house(5, 40, null, 5), house(15, 40, null, 5), house(25, 40, null, 5), bystander(60, 20)]), 120,
    [draw(1, 0, 0, 1), draw(1, 0, 0, 2), draw(1, 0, 1, 3), draw(1, 0, 1, 4), draw(1, 0, 1, 5)], false, 777),
  scenario('alive-cap-skip', 'Alive cap 30: a due spawn is skipped (timer still consumed) once 30 troops are alive.',
    buildLevel('golden-alive-cap', [house(0, 0, 0, 64), house(120, 0, null, 5), house(120, 3, null, 5), house(120, 6, null, 5), bystander(0, 40)]), 300,
    [draw(1, 0, 0, 1), draw(1, 0, 0, 2), draw(1, 0, 0, 3)]),
  scenario('win-ignored-flip', 'Win when the human owns every non-ignored building; ignored buildings flip to the winner.',
    buildLevel('golden-win', [house(0, 0, 0, 64), house(5, 0, null, 1), house(0, 20, null, 3, { ignore: true }), house(30, 20, 1, 5, { ignore: true })]), 60,
    [draw(1, 0, 0, 1), cut(28, 0, 0, 1)], true),
  scenario('loss', 'Loss when the human owns no non-ignored building (an ignored one does not save it); winner null.',
    buildLevel('golden-loss', [house(0, 0, 0, 1), house(5, 0, 1, 64), house(0, 20, 0, 3, { ignore: true })]), 60,
    [draw(1, 1, 1, 0), cut(28, 1, 1, 0)], true),
  scenario('timeout', 'Time limit 3 s = 60 ticks with no decisive result: timeout, winner null.',
    buildLevel('golden-timeout', [house(0, 0, 0, 20), house(40, 0, 1, 20), house(20, 20, null, 5)], { timeLimitSec: 3 }), 100,
    [draw(1, 0, 0, 2)], true),
  scenario('rejections', 'Every draw/cut reject reason reachable in SP03: self, duplicate, no-slot, not-owner, unknown-id, malformed, not-drawer, no-line.',
    buildLevel('golden-rejections', [
      house(0, 0, 0, 1), house(30, 0, null, 5), house(30, 10, null, 5), house(60, 0, 1, 10), house(100, 100, 0, 3, { arch: 'tower' }), house(60, 30, null, 5),
    ]), 10, [
      draw(1, 0, 0, 0), draw(1, 0, 0, 1), draw(1, 0, 0, 1), draw(1, 0, 0, 2), draw(1, 0, 3, 5), draw(1, 0, 0, 99),
      raw(1, { type: 'DrawLine', player: 0, from: 0 }), raw(1, { type: 'Bogus' }), draw(1, 0, 4, 1),
      draw(2, 1, 3, 5), draw(2, 0, 0, 1),
      cut(3, 0, 3, 5), cut(3, 0, 0, 2), cut(3, 0, 0, 99), cut(3, 0, 0, 1),
      draw(4, 0, 0, 2),
    ]),
];
