import type { CompiledLevel } from '@node-arena/content';
import { hashCompiledLevel } from '../../../content/src/hash.js';
import type { Command } from '../../src/index.js';

export interface Scenario {
  name: string;
  purpose: string;
  fullGame: boolean;
  level: CompiledLevel;
  seed: number;
  ticks: number;
  commands: { tick: number; cmd: Command }[];
}
type Tower = { owner: number; x: number; count?: number; rate?: number; cap?: number; troop?: number; slots?: number[] };
function level(id: string, towers: Tower[], speeds = [100], limit = 10): CompiledLevel {
  const compiled: Omit<CompiledLevel, 'simHash' | 'botHash'> = {
    bounds: { w: 2000, h: 1000 }, globals: { timeLimitSec: limit, theme: '' },
    id, componentNames: ['capturable', 'drawsLines', 'garrison', 'generates'],
    timeLimitSec: limit, visual: '', bots: [],
    players: [0, 1].map(i => ({ id: `p${i}`, team: `team${i}`, kind: i === 0 ? 'human' : 'bot', colorKey: `p${i}` })),
    towers: towers.map((t, i) => ({ id: String.fromCharCode(97 + i), x: t.x, y: 0, owner: t.owner, garrison: t.count ?? 0,
      archetype: 'golden', visual: '', footprintRadius: 0, components: {
        garrison: { cap: t.cap ?? 50 }, generates: { troop: t.troop ?? 0, ratePerSec: t.rate ?? 0 },
        drawsLines: { extraSlotAbove: t.slots ?? [] }, capturable: {},
      } })),
    kinds: speeds.map((speedMilli, i) => ({ id: `kind-${i}`, speedMilli, value: 1, visual: '' })),
  };
  return { ...compiled, simHash: hashCompiledLevel(compiled), botHash: {} };
}
const draw = (tick: number, player: string, from: string, to: string): Scenario['commands'][number] => ({ tick, cmd: { type: 'DrawLine', player, from, to } });
const cut = (tick: number, player: string, from: string, to: string): Scenario['commands'][number] => ({ tick, cmd: { type: 'CutLine', player, from, to } });
function scenario(name: string, purpose: string, compiled: CompiledLevel, ticks: number, commands: Scenario['commands'] = [], fullGame = false): Scenario {
  return { name, purpose, level: compiled, seed: 4294967295, ticks, commands, fullGame };
}
/** SP02 owns these compiled test levels. No campaign content or bot policies. */
export const scenarios: Scenario[] = [
  scenario('generation-cap', 'Fractional generation fills the cap and stops without banking a burst.',
    level('generation-cap', [{ owner: 0, x: 0, rate: 15000, cap: 2 }, { owner: 1, x: 1000 }]), 20),
  scenario('persistent-cut-replaced', 'Persistent permission sends each tick; player cuts and friendly reverse replacement preserve in-flight troops.',
    level('persistent-cut-replaced', [{ owner: 0, x: 0, rate: 20000 }, { owner: 0, x: 20, rate: 20000 }, { owner: 1, x: 1000 }]), 12,
    [draw(0, 'p0', 'a', 'b'), draw(1, 'p0', 'b', 'a'), cut(3, 'p0', 'b', 'a'), draw(4, 'p0', 'a', 'c'), cut(7, 'p0', 'a', 'c')]),
  scenario('slot-reduction', 'An incoming hit crosses the strict extra-slot threshold and cuts the newest outgoing line.',
    level('slot-reduction', [{ owner: 0, x: 0, count: 11, rate: 20000, slots: [10] }, { owner: 1, x: 5, rate: 20000 }, { owner: -1, x: 1000 }, { owner: -1, x: 1500 }]), 3,
    [draw(0, 'p0', 'a', 'c'), draw(0, 'p0', 'a', 'd'), draw(0, 'p1', 'b', 'a')]),
  scenario('head-on-clash', 'Hostile generated FIFO fronts cancel at the equality boundary.',
    level('head-on-clash', [{ owner: 0, x: 0, rate: 20000 }, { owner: 1, x: 20, rate: 20000 }]), 8,
    [draw(0, 'p1', 'b', 'a'), draw(0, 'p0', 'a', 'b')]),
  scenario('overshoot-capture', 'Larger overshoot beats channel order; later same-tick arrivals recapture the changed owner.',
    level('overshoot-capture', [{ owner: 1, x: 0, rate: 20000 }, { owner: 0, x: 5, rate: 20000, troop: 1 }, { owner: -1, x: 10 }], [210, 200]), 2,
    [draw(0, 'p1', 'a', 'c'), draw(0, 'p0', 'b', 'c')]),
  scenario('cap-overflow', 'Friendly arrivals overflow a capped tower while a capped sender keeps generating on its line.',
    level('cap-overflow', [{ owner: 0, x: 0, rate: 20000, count: 2, cap: 2 }, { owner: 0, x: 5, count: 2, cap: 2 }, { owner: 1, x: 1000 }]), 5,
    [draw(0, 'p0', 'a', 'b')]),
  scenario('command-rejections', 'Rejected duplicate, self and unknown submissions remain in the replay in submitted order.',
    level('command-rejections', [{ owner: 0, x: 0 }, { owner: 1, x: 1000 }]), 21,
    [draw(0, 'p0', 'a', 'b'), draw(0, 'p0', 'a', 'b'), draw(0, 'p0', 'a', 'a'), draw(0, 'missing', 'a', 'b')]),
  scenario('mutual-defeat', 'Players with no towers or transit are eliminated together and the result is draw.',
    level('mutual-defeat', [{ owner: -1, x: 0 }]), 1),
  scenario('full-transit-win', 'Complete game: capture cuts enemy permission; last enemy troops keep that player alive until arrival, then human wins.',
    level('full-transit-win', [{ owner: 0, x: 0, rate: 20000 }, { owner: 1, x: 5, rate: 20000 }, { owner: 0, x: 500, count: 5 }]), 200,
    [draw(0, 'p0', 'a', 'b'), draw(0, 'p1', 'b', 'c')], true),
  scenario('full-human-loss', 'Complete game: sustained enemy arrivals remove the last human tower and yield lost.',
    level('full-human-loss', [{ owner: 0, x: 0, count: 3 }, { owner: 1, x: 5, rate: 20000 }]), 200,
    [draw(0, 'p1', 'b', 'a')], true),
  scenario('full-stalemate-timeout', 'Complete game: opposing persistent lines clash until the authoritative tick limit produces timeout.',
    level('full-stalemate-timeout', [{ owner: 0, x: 0, count: 4, rate: 20000 }, { owner: 1, x: 20, count: 4, rate: 20000 }], [100], 3), 60,
    [draw(0, 'p0', 'a', 'b'), draw(0, 'p1', 'b', 'a')], true),
];
