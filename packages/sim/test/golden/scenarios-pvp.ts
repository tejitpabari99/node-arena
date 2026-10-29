import type { Command } from '@node-arena/defs';
import { buildPvpLevel } from './levels.js';
import type { Scenario } from './scenarios.js';

type Entry = Scenario['commands'][number];
/** Effective-tick form (the tick whose phase 1 applies it), as in scenarios.ts. */
const draw = (eff: number, player: number, from: number, to: number): Entry => ({ tick: eff - 1, cmd: { type: 'DrawLine', player, from, to } });
const forfeit = (eff: number, player: number): Entry => ({ tick: eff - 1, cmd: { type: 'Forfeit', player } as Command });
const house = (x: number, z: number, owner: number | null, level: number) => ({ at: [x, z] as [number, number], owner, level });

/**
 * R-FFT-01..03: 4 seats, teams [0,0,1,2]. Seat 0 forfeits (teammate keeps team 0 alive, play continues), seat 1
 * forfeits (team 0 gone, match continues), seats 2 and 3 forfeit in the same tick (draw, no winner).
 */
export const pvpScenarios: Scenario[] = [{
  name: 'pvp-forfeit',
  purpose: 'Forfeit: buildings neutral keeping level, lines cancelled, troops die; teammate survives; same-tick forfeit of all remaining teams is a draw.',
  fullGame: true,
  level: buildPvpLevel('golden-pvp-forfeit', 4, [
    house(0, 0, 0, 30), house(0, 12, 1, 30), house(60, 0, 2, 30), house(60, 12, 3, 30), house(30, 6, null, 5), house(30, 30, null, 5),
  ]),
  seed: 20261029,
  ticks: 200,
  teams: [0, 0, 1, 2],
  commands: [
    draw(1, 0, 0, 4), draw(1, 1, 1, 4), draw(1, 2, 2, 4), draw(1, 3, 3, 5),
    forfeit(60, 0), forfeit(100, 0) /* already eliminated: rejected */, forfeit(100, 1), forfeit(140, 3), forfeit(140, 2),
  ],
}];
