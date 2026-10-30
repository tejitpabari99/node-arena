import Type, { type Static } from 'typebox';

const index = () => Type.Integer({ minimum: 0, maximum: 2147483647 });

/** Closed command set (GAME_RULES.md 4.1). Boosters are deferred. Reject reasons for DrawLine: 03 R4; 04 appends blocker codes. */
export const COMMANDS = {
  DrawLine: {
    id: 'DrawLine',
    payload: Type.Object({ player: index(), from: index(), to: index() }, { additionalProperties: false }),
    rejectReasons: ['gameover', 'malformed', 'unknown-id', 'not-owner', 'self', 'not-drawer', 'duplicate', 'no-slot', 'blocked-obstacle', 'blocked-building'],
    ruleIds: ['R-LIN-01', 'R-LIN-02', 'R-LIN-03', 'R-LIN-04', 'R-ENT-04'],
  },
  CutLine: {
    id: 'CutLine',
    payload: Type.Object({ player: index(), from: index(), to: index() }, { additionalProperties: false }),
    rejectReasons: ['gameover', 'malformed', 'unknown-id', 'no-line', 'not-owner'],
    ruleIds: ['R-LIN-05', 'R-ENT-04'],
  },
  /** System command (server/replay only, never a seat or bot): pvp seat elimination (R-FFT-01..03). */
  Forfeit: {
    id: 'Forfeit',
    payload: Type.Object({ player: index() }, { additionalProperties: false }),
    rejectReasons: ['gameover', 'malformed', 'unknown-id', 'not-pvp', 'eliminated'],
    ruleIds: ['R-FFT-01', 'R-FFT-02', 'R-FFT-03'],
  },
} as const;

export type CommandId = keyof typeof COMMANDS;
export type CommandOf<K extends CommandId> = { type: K } & Static<(typeof COMMANDS)[K]['payload']>;
export type Command = { [K in CommandId]: CommandOf<K> }[CommandId];
export type RejectReason = (typeof COMMANDS)[CommandId]['rejectReasons'][number];
