import Type, { type Static } from 'typebox';

const int = () => Type.Integer({ minimum: -2147483647, maximum: 2147483647 });
const idx = () => Type.Integer({ minimum: 0, maximum: 2147483647 });
/** Milli-int world coordinate. */
const milli = int;

const ref = () => Type.Object({ channel: idx(), seq: idx(), owner: int() }, { additionalProperties: false });

/**
 * Complete payload types of 03 PRD R7 (final; 04 and 07 only emit/consume). Events never alter state.
 * Coordinates (`x`, `z`) are milli ints. Strict objects: an undeclared field is a type error (see test/events.types.ts).
 */
export const EVENTS = {
  LineDrawn: { id: 'LineDrawn', payload: Type.Object({ from: idx(), to: idx(), owner: int(), drawSeq: idx() }, { additionalProperties: false }) },
  LineCut: { id: 'LineCut', payload: Type.Object({ from: idx(), to: idx(), reason: Type.Union([Type.Literal('player'), Type.Literal('replaced'), Type.Literal('captured')]) }, { additionalProperties: false }) },
  TroopSpawned: { id: 'TroopSpawned', payload: Type.Object({ channel: idx(), seq: idx(), owner: int(), kind: Type.String(), cause: Type.Union([Type.Literal('timer'), Type.Literal('forward')]) }, { additionalProperties: false }) },
  TroopArrived: { id: 'TroopArrived', payload: Type.Object({ channel: idx(), seq: idx(), owner: int(), kind: Type.String(), effect: Type.Union([Type.Literal('reinforce'), Type.Literal('overflow'), Type.Literal('hit')]) }, { additionalProperties: false }) },
  BuildingCaptured: { id: 'BuildingCaptured', payload: Type.Object({ building: idx(), from: int(), to: int(), cause: Type.Optional(Type.String()) }, { additionalProperties: false }) },
  MatchOver: { id: 'MatchOver', payload: Type.Object({ outcome: Type.Union([Type.Literal('won'), Type.Literal('lost'), Type.Literal('timeout')]), winner: Type.Union([idx(), Type.Null()]) }, { additionalProperties: false }) },
  CommandRejected: { id: 'CommandRejected', payload: Type.Object({ player: idx(), command: Type.String(), reason: Type.String() }, { additionalProperties: false }) },
  Clash: { id: 'Clash', payload: Type.Object({ kind: Type.Union([Type.Literal('headon'), Type.Literal('crossing')]), a: ref(), b: ref(), x: milli(), z: milli() }, { additionalProperties: false }) },
  TroopDied: { id: 'TroopDied', payload: Type.Object({ channel: idx(), seq: idx(), owner: int(), kind: Type.String(), cause: Type.Union([Type.Literal('clash'), Type.Literal('capture'), Type.Literal('tower')]), x: milli(), z: milli() }, { additionalProperties: false }) },
  TowerShot: {
    id: 'TowerShot',
    payload: Type.Object({
      tower: idx(),
      target: Type.Object({ kind: Type.Union([Type.Literal('troop'), Type.Literal('house')]), channel: Type.Optional(idx()), seq: Type.Optional(idx()), building: Type.Optional(idx()) }, { additionalProperties: false }),
      x: milli(),
      z: milli(),
    }, { additionalProperties: false }),
  },
} as const;

export type EventId = keyof typeof EVENTS;
export type EventOf<K extends EventId> = { type: K } & Static<(typeof EVENTS)[K]['payload']>;
/** Payload without the `type` tag. */
export type EventPayload<K extends EventId> = Static<(typeof EVENTS)[K]['payload']>;
export type SimEvent = { [K in EventId]: EventOf<K> }[EventId];
