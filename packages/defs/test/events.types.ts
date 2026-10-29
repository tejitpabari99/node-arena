// Type test (checked by tsconfig.check.json via `pnpm typecheck:defs`): consumers may emit/read only R7 fields.
import type { CommandId, EventId, EventOf, RejectReason, SimEvent } from '../src/index.js';

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const assertType = <_T extends true>(): void => {};

// Exact payload shapes (milli-int coordinates are plain numbers).
assertType<Equal<EventOf<'LineDrawn'>, { type: 'LineDrawn'; from: number; to: number; owner: number; drawSeq: number }>>();
assertType<Equal<EventOf<'LineCut'>['reason'], 'player' | 'replaced' | 'captured'>>();
assertType<Equal<EventOf<'TroopSpawned'>['cause'], 'timer' | 'forward'>>();
assertType<Equal<EventOf<'TroopArrived'>['effect'], 'reinforce' | 'overflow' | 'hit'>>();
assertType<Equal<EventOf<'MatchOver'>['outcome'], 'won' | 'lost' | 'timeout' | 'victory' | 'timeLimit' | 'draw'>>
assertType<Equal<EventOf<'MatchOver'>['winners'], number[] | undefined>>();
assertType<Equal<EventOf<'SeatEliminated'>['player'], number>>();
assertType<Equal<EventOf<'MatchOver'>['winner'], number | null>>();
assertType<Equal<EventOf<'Clash'>['kind'], 'headon' | 'crossing'>>();
assertType<Equal<EventOf<'Clash'>['a'], { channel: number; seq: number; owner: number }>>();
assertType<Equal<EventOf<'TroopDied'>['cause'], 'clash' | 'capture' | 'tower'>>();
assertType<Equal<EventOf<'TowerShot'>['target']['kind'], 'troop' | 'house'>>();
assertType<Equal<EventOf<'CommandRejected'>['command'], CommandId>>();
assertType<Equal<EventOf<'CommandRejected'>['reason'], RejectReason>>();
assertType<Equal<SimEvent['type'], EventId>>();
assertType<Equal<EventId, 'LineDrawn' | 'LineCut' | 'TroopSpawned' | 'TroopArrived' | 'BuildingCaptured' | 'MatchOver' | 'SeatEliminated' | 'CommandRejected' | 'Clash' | 'TroopDied' | 'TowerShot'>>();

// Emitting or reading an undeclared field must fail to compile.
// @ts-expect-error unknown field on emit
export const emitExtra: EventOf<'Clash'> = { type: 'Clash', kind: 'headon', a: { channel: 0, seq: 0, owner: 0 }, b: { channel: 1, seq: 0, owner: 1 }, x: 0, z: 0, damage: 1 };
// @ts-expect-error missing required field
export const emitMissing: EventOf<'TroopDied'> = { type: 'TroopDied', channel: 0, seq: 0, owner: 0, kind: 'soldier', cause: 'clash', x: 0 };
// @ts-expect-error cause outside the closed set
export const emitCause: EventOf<'TroopDied'> = { type: 'TroopDied', channel: 0, seq: 0, owner: 0, kind: 'soldier', cause: 'bomb', x: 0, z: 0 };
export function readExtra(e: EventOf<'TowerShot'>): unknown {
  // @ts-expect-error not a TowerShot field
  return e.damage;
}
export function narrow(e: SimEvent): number | undefined {
  if (e.type === 'TroopDied') return e.x;
  // @ts-expect-error `x` is not on LineCut
  if (e.type === 'LineCut') return e.x;
  return undefined;
}
