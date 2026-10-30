import type { Command } from '@node-arena/defs';
import { byteSize } from './codec.js';
import {
  ERROR_CODES, type ClientMessage, type ErrorCode, type LobbySeat, type SeatConfig, type SeatKind, type SeatStatus,
  type PauseHold, type ServerMessage, type StartSeat, type TickCmds, type Versions, type WireCommand,
} from './messages.js';
import { HASH_INTERVAL } from './version.js';

/**
 * Strict untrusted-input validation (PRD 02 R2, Decision 4). Hand-written; every validator builds a FRESH object
 * from known fields only, so `__proto__` / `constructor` keys never leak. Never throws.
 */

/** Client frames are tiny (largest: hello with 2048-char auth). */
export const MAX_CLIENT_BYTES = 4096;
/** Server frames include catchup chunks (<=2000 ticks of sparse cmds, ~75 B each worst case) -> 1 MiB. */
export const MAX_SERVER_BYTES = 1 << 20;
export const MAX_AUTH_LEN = 2048;
export const MAX_INT = 2147483647;
const MAX_SEATS = 8;
const MAX_SHORT = 64;
const MAX_DETAIL = 256;
const MAX_CMDS = 20000;

export type ParseResult<M> =
  | { ok: true; msg: M }
  | { ok: false; code: ErrorCode; /** server only: unknown `t`, caller should drop silently */ ignorable?: boolean };

class Bad extends Error {}
const bad = (): never => { throw new Bad(); };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o: Rec, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function rec(v: unknown): Rec { return isRec(v) ? v : bad(); }
function exact(o: Rec, allowed: readonly string[]): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) bad();
}
function int(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_INT ? v : bad();
}
function bool(v: unknown): boolean { return typeof v === 'boolean' ? v : bad(); }
function str(v: unknown, max = MAX_SHORT, min = 1): string {
  return typeof v === 'string' && v.length >= min && v.length <= max ? v : bad();
}
function oneOf<T extends string>(v: unknown, set: readonly T[]): T {
  return typeof v === 'string' && (set as readonly string[]).includes(v) ? (v as T) : bad();
}
function opt<T>(o: Rec, k: string, f: (v: unknown) => T): T | undefined {
  return has(o, k) && o[k] !== undefined ? f(o[k]) : undefined;
}
function arr<T>(v: unknown, max: number, f: (v: unknown) => T): T[] {
  if (!Array.isArray(v) || v.length > max) return bad();
  const out: T[] = [];
  for (const x of v) out.push(f(x));
  return out;
}
const withOpt = <T extends object>(base: T, extra: Rec): T => {
  for (const k of Object.keys(extra)) if (extra[k] !== undefined) (base as Rec)[k] = extra[k];
  return base;
};

const HEX16 = /^[0-9a-f]{16}$/;
const TOKEN = /^[0-9a-f]{32}$/;
const CODE = /^[A-Z0-9]{4}$/;
const hash16 = (v: unknown): string => (typeof v === 'string' && HEX16.test(v) ? v : bad());

function nick(v: unknown): string {
  if (typeof v !== 'string') return bad();
  const s = v.trim();
  if (s.length < 1 || s.length > 20) return bad();
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) return bad();
  }
  return s;
}

const SEAT_KINDS = ['human', 'bot', 'empty'] as const satisfies readonly SeatKind[];
const SEAT_STATUS = ['connected', 'away'] as const satisfies readonly SeatStatus[];

function versions(v: unknown, strict: boolean): Versions {
  const o = rec(v);
  if (strict) exact(o, ['rules', 'schema', 'content', 'bot']);
  return { rules: str(o.rules), schema: str(o.schema), content: str(o.content), bot: str(o.bot) };
}

/** Wire command from a client: strict, `player` forbidden. */
function wireCommand(v: unknown): WireCommand {
  const o = rec(v);
  exact(o, ['type', 'from', 'to']);
  return { type: oneOf(o.type, ['DrawLine', 'CutLine'] as const), from: int(o.from), to: int(o.to) };
}
/** Full command (server -> client): tolerant of unknown fields. */
function command(v: unknown): Command {
  const o = rec(v);
  // System command: server-issued only; never accepted from a client (wireCommand is DrawLine/CutLine only).
  if (o.type === 'Forfeit') return { type: 'Forfeit', player: int(o.player) };
  return { type: oneOf(o.type, ['DrawLine', 'CutLine'] as const), player: int(o.player), from: int(o.from), to: int(o.to) };
}
function pauseHold(v: unknown): PauseHold {
  const o = rec(v);
  return { player: int(o.player), reason: oneOf(o.reason, ['manual', 'disconnect'] as const), connected: bool(o.connected), since: int(o.since) };
}
function tickCmds(v: unknown): TickCmds {
  const o = rec(v);
  return { tick: int(o.tick), cmd: command(o.cmd) };
}
function seatConfig(v: unknown, strict: boolean): SeatConfig {
  const o = rec(v);
  if (strict) exact(o, ['kind', 'difficulty', 'team']);
  return withOpt({ kind: oneOf(o.kind, SEAT_KINDS), team: int(o.team) } as SeatConfig, { difficulty: opt(o, 'difficulty', (x) => str(x, 32)) });
}
function lobbySeat(v: unknown): LobbySeat {
  const o = rec(v);
  const base = seatConfig(o, false) as LobbySeat;
  const occupant = opt(o, 'occupant', (x) => {
    const q = rec(x);
    return { nick: str(q.nick, 20), ready: bool(q.ready), status: oneOf(q.status, SEAT_STATUS) };
  });
  return withOpt(base, { occupant });
}
function startSeat(v: unknown): StartSeat {
  const o = rec(v);
  return withOpt(
    { player: int(o.player), kind: oneOf(o.kind, SEAT_KINDS), team: int(o.team), nick: str(o.nick, 20, 0) } as StartSeat,
    { difficulty: opt(o, 'difficulty', (x) => str(x, 32)) },
  );
}

const CLIENT_FIELDS: Record<string, readonly string[]> = {
  hello: ['t', 'pv', 'versions', 'nick', 'token', 'auth'],
  'room.create': ['t'], 'room.join': ['t', 'code', 'role'], 'room.leave': ['t'],
  'lobby.update': ['t', 'levelId', 'seats'], 'lobby.ready': ['t', 'ready'], 'lobby.start': ['t'], rematch: ['t'],
  cmd: ['t', 'c', 'cid'], hash: ['t', 'tick', 'h'], resync: ['t'], ping: ['t', 'id'],
  pause: ['t'], resume: ['t', 'epoch'], quit: ['t'],
};

function clientMsg(o: Rec): ClientMessage {
  const t = o.t;
  if (typeof t !== 'string' || !has(CLIENT_FIELDS, t)) throw new Unknown();
  exact(o, CLIENT_FIELDS[t]!);
  switch (t) {
    case 'hello':
      return withOpt(
        {
          t, pv: int(o.pv), versions: versions(o.versions, true), nick: nick(o.nick),
          token: typeof o.token === 'string' && TOKEN.test(o.token) ? o.token : bad(),
        },
        { auth: opt(o, 'auth', (x) => str(x, MAX_AUTH_LEN, 0)) },
      ) as ClientMessage;
    case 'room.create': return { t };
    case 'room.join':
      return { t, code: typeof o.code === 'string' && CODE.test(o.code) ? o.code : bad(), role: oneOf(o.role, ['play', 'watch'] as const) };
    case 'room.leave': return { t };
    case 'lobby.update':
      return { t, levelId: str(o.levelId), seats: arr(o.seats, MAX_SEATS, (s) => seatConfig(s, true)) };
    case 'lobby.ready': return { t, ready: bool(o.ready) };
    case 'lobby.start': return { t };
    case 'rematch': return { t };
    case 'cmd': return withOpt({ t, c: wireCommand(o.c) }, { cid: opt(o, 'cid', int) }) as ClientMessage;
    case 'hash': {
      const tick = int(o.tick);
      if (tick % HASH_INTERVAL !== 0) bad();
      return { t, tick, h: hash16(o.h) };
    }
    case 'resync': return { t };
    case 'pause': return { t };
    case 'resume': return { t, epoch: int(o.epoch) };
    case 'quit': return { t };
    default: return { t: 'ping', id: int(o.id) };
  }
}

const SERVER_TYPES = [
  'welcome', 'room.joined', 'lobby.state', 'room.closed', 'start', 'tick', 'catchup', 'ticks', 'desync',
  'end', 'pong', 'pause.state', 'start.cancel', 'server.draining', 'error',
] as const;

function serverMsg(o: Rec): ServerMessage {
  const t = o.t;
  if (typeof t !== 'string' || !(SERVER_TYPES as readonly string[]).includes(t)) throw new Unknown();
  switch (t as (typeof SERVER_TYPES)[number]) {
    case 'welcome':
      return withOpt(
        { t: 'welcome', pv: int(o.pv), playerId: str(o.playerId), serverVersions: versions(o.serverVersions, false) },
        {
          resume: opt(o, 'resume', (x) => {
            const r = rec(x);
            return { code: typeof r.code === 'string' && CODE.test(r.code) ? r.code : bad(), seat: int(r.seat) };
          }),
        },
      ) as ServerMessage;
    case 'room.joined': {
      const y = rec(o.you);
      return {
        t: 'room.joined', code: typeof o.code === 'string' && CODE.test(o.code) ? o.code : bad(),
        you: { seat: y.seat === null ? null : int(y.seat), host: bool(y.host) },
      };
    }
    case 'lobby.state':
      return {
        t: 'lobby.state', levelId: str(o.levelId), timeLimitSec: int(o.timeLimitSec),
        host: o.host === null ? null : int(o.host), seats: arr(o.seats, MAX_SEATS, lobbySeat), spectators: int(o.spectators),
      };
    case 'room.closed': return { t: 'room.closed', reason: str(o.reason, MAX_SHORT) };
    case 'start':
      return {
        t: 'start', matchId: str(o.matchId), levelId: str(o.levelId), simHash: hash16(o.simHash), seed: int(o.seed),
        seats: arr(o.seats, MAX_SEATS, startSeat), youPlayer: o.youPlayer === null ? null : int(o.youPlayer),
        inputDelay: int(o.inputDelay), countdownMs: int(o.countdownMs), timeLimitTicks: int(o.timeLimitTicks),
        hashInterval: o.hashInterval === HASH_INTERVAL ? HASH_INTERVAL : bad(),
      };
    case 'tick':
      return withOpt({ t: 'tick', n: int(o.n) }, { c: opt(o, 'c', (x) => arr(x, MAX_CMDS, command)) }) as ServerMessage;
    case 'catchup':
      return { t: 'catchup', from: int(o.from), to: int(o.to), cmds: arr(o.cmds, MAX_CMDS, tickCmds), done: bool(o.done) };
    case 'ticks': return { t: 'ticks', from: int(o.from), to: int(o.to), cmds: arr(o.cmds, MAX_CMDS, tickCmds) };
    case 'desync': return { t: 'desync', tick: int(o.tick), serverHash: hash16(o.serverHash) };
    case 'end': {
      const oc = rec(o.outcome);
      return {
        t: 'end', finalTick: int(o.finalTick), finalHash: hash16(o.finalHash),
        outcome: {
          outcome: oneOf(oc.outcome, ['victory', 'timeLimit', 'draw'] as const),
          winners: arr(oc.winners, MAX_SEATS, int), winner: oc.winner === null ? null : int(oc.winner),
        },
      };
    }
    case 'pause.state':
      return {
        t: 'pause.state', epoch: int(o.epoch), paused: bool(o.paused), tick: int(o.tick), unlimited: bool(o.unlimited),
        holds: arr(o.holds, 4, pauseHold),
        budgets: arr(o.budgets, 4, (x) => (x === null ? null : typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 30000 ? x : bad())),
      };
    case 'start.cancel': return { t: 'start.cancel', matchId: str(o.matchId) };
    case 'server.draining': return { t: 'server.draining', deadlineMs: int(o.deadlineMs) };
    case 'pong': return { t: 'pong', id: int(o.id), tick: int(o.tick) };
    case 'error':
      return withOpt(
        { t: 'error', code: oneOf(o.code, ERROR_CODES) },
        { detail: opt(o, 'detail', (x) => str(x, MAX_DETAIL, 0)) },
      ) as ServerMessage;
  }
}

class Unknown extends Error {}

function run<M>(raw: unknown, max: number, build: (o: Rec) => M, server: boolean): ParseResult<M> {
  try {
    if (typeof raw !== 'string') return { ok: false, code: 'bad-json' };
    // UTF-16 length <= byte length, so this cheap pre-check never rejects a frame that fits.
    if (raw.length > max || byteSize(raw) > max) return { ok: false, code: 'too-large' };
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return { ok: false, code: 'bad-json' }; }
    if (!isRec(parsed)) return { ok: false, code: 'bad-message' };
    return { ok: true, msg: build(parsed) };
  } catch (e) {
    if (e instanceof Unknown) return server ? { ok: false, code: 'unknown-type', ignorable: true } : { ok: false, code: 'unknown-type' };
    return { ok: false, code: 'bad-message' };
  }
}

/** Never throws. Strict: unknown fields/types rejected; `player` on `cmd` rejected. */
export function parseClientMessage(raw: unknown): ParseResult<ClientMessage> {
  return run(raw, MAX_CLIENT_BYTES, clientMsg, false);
}
/** Never throws. Tolerates unknown fields; unknown `t` -> `{ok:false, code:'unknown-type', ignorable:true}`. */
export function parseServerMessage(raw: unknown): ParseResult<ServerMessage> {
  return run(raw, MAX_SERVER_BYTES, serverMsg, true);
}
