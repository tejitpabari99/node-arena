import type { Command } from '@node-arena/defs';
import type { EndOutcome } from './outcome.js';

/** Wire message catalogue (PRD 02 R1). Discriminator `t`. Types only; validation lives in validate.ts. */

export const ERROR_CODES = [
  'bad-json', 'too-large', 'bad-message', 'unknown-type', 'version-mismatch', 'not-authed', 'not-in-room',
  'not-host', 'not-your-seat', 'rate-limited', 'room-full', 'room-not-found', 'spectators-full', 'bad-lobby',
  'not-ready', 'match-in-progress', 'desync', 'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type Versions = { rules: string; schema: string; content: string; bot: string };
/** Client command: server fills `player`, so it is absent on the wire. */
export type WireCommand = Command extends infer C ? (C extends Command ? Omit<C, 'player'> : never) : never;
export type SeatKind = 'human' | 'bot' | 'empty';
export type SeatStatus = 'connected' | 'grace' | 'bot';
export type SeatConfig = { kind: SeatKind; difficulty?: string; team: number };
export type LobbySeat = SeatConfig & { occupant?: { nick: string; ready: boolean; status: SeatStatus } };
export type StartSeat = { player: number; kind: SeatKind; team: number; nick: string; difficulty?: string };
export type TickCmds = { tick: number; cmd: Command };
export type RoomClosedReason = 'shutdown' | 'server-restart' | 'internal' | 'idle' | (string & {});
export type { EndOutcome } from './outcome.js';

// Client -> Server
export type HelloMsg = { t: 'hello'; pv: number; versions: Versions; nick: string; token: string; auth?: string };
export type RoomCreateMsg = { t: 'room.create' };
export type RoomJoinMsg = { t: 'room.join'; code: string; role: 'play' | 'watch' };
export type RoomLeaveMsg = { t: 'room.leave' };
export type LobbyUpdateMsg = { t: 'lobby.update'; levelId: string; seats: SeatConfig[] };
export type LobbyReadyMsg = { t: 'lobby.ready'; ready: boolean };
export type LobbyStartMsg = { t: 'lobby.start' };
export type RematchMsg = { t: 'rematch' };
export type CmdMsg = { t: 'cmd'; c: WireCommand; cid?: number };
export type HashMsg = { t: 'hash'; tick: number; h: string };
export type ResyncMsg = { t: 'resync' };
export type PingMsg = { t: 'ping'; id: number };

export type ClientMessage =
  | HelloMsg | RoomCreateMsg | RoomJoinMsg | RoomLeaveMsg | LobbyUpdateMsg | LobbyReadyMsg
  | LobbyStartMsg | RematchMsg | CmdMsg | HashMsg | ResyncMsg | PingMsg;

// Server -> Client
export type WelcomeMsg = {
  t: 'welcome'; pv: number; playerId: string; resume?: { code: string; seat: number }; serverVersions: Versions;
};
export type RoomJoinedMsg = { t: 'room.joined'; code: string; you: { seat: number | null; host: boolean } };
export type LobbyStateMsg = {
  t: 'lobby.state'; levelId: string; timeLimitSec: number; host: number | null; seats: LobbySeat[]; spectators: number;
};
export type RoomClosedMsg = { t: 'room.closed'; reason: RoomClosedReason };
export type StartMsg = {
  t: 'start'; matchId: string; levelId: string; simHash: string; seed: number; seats: StartSeat[];
  youPlayer: number | null; inputDelay: number; countdownMs: number; timeLimitTicks: number; hashInterval: number;
};
export type TickMsg = { t: 'tick'; n: number; c?: Command[] };
export type CatchupMsg = { t: 'catchup'; from: number; to: number; cmds: TickCmds[]; done: boolean };
export type TicksMsg = { t: 'ticks'; from: number; to: number; cmds: TickCmds[] };
export type DesyncMsg = { t: 'desync'; tick: number; serverHash: string };
export type SeatStatusMsg = { t: 'seat.status'; player: number; status: SeatStatus; graceMs?: number };
export type EndMsg = { t: 'end'; outcome: EndOutcome; finalTick: number; finalHash: string };
export type PongMsg = { t: 'pong'; id: number; tick: number };
export type ErrorMsg = { t: 'error'; code: ErrorCode; detail?: string };

export type ServerMessage =
  | WelcomeMsg | RoomJoinedMsg | LobbyStateMsg | RoomClosedMsg | StartMsg | TickMsg | CatchupMsg
  | TicksMsg | DesyncMsg | SeatStatusMsg | EndMsg | PongMsg | ErrorMsg;

export type ClientMessageType = ClientMessage['t'];
export type ServerMessageType = ServerMessage['t'];
export type MessageOf<M extends { t: string }, T extends M['t']> = Extract<M, { t: T }>;
