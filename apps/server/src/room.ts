import { randomInt as cryptoRandomInt } from 'node:crypto';
import { TICK_RATE } from '@node-arena/sim';
import type { CompiledLevel } from '@node-arena/content';
import {
  HASH_INTERVAL, MAX_INT, type ClientMessage, type LobbySeat, type SeatConfig, type ServerMessage, type StartMsg, type StartSeat,
} from '@node-arena/net';
import type { Clock } from './clock.js';
import type { Conn } from './conn.js';
import type { HubHandler } from './hub.js';
import type { Logger } from './log.js';
import type { ServerContent } from './content.js';

/** 31 unambiguous chars (no 0 O 1 I L); matches net's `^[A-Z0-9]{4}$`. 31^4 = 923,521 codes. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 4;
export const COUNTDOWN_MS = 3000;
export const ENDED_ROOM_TTL_MS = 10 * 60_000;
const SWEEP_MS = 60_000;
const MAX_CODE_TRIES = 64;

export type RoomState = 'lobby' | 'countdown' | 'running' | 'ended' | 'closed';

interface Occupant { playerId: string; nick: string; ready: boolean; conn: Conn }
interface Seat extends SeatConfig { occupant?: Occupant }

/** Everything Task 6 needs to build the referee and lockstep for a started match. */
export interface MatchStart {
  code: string;
  matchId: string;
  levelId: string;
  seed: number;
  /** Per-seat team ids (SeatSetup.teams). */
  teams: number[];
  seats: StartSeat[];
  /** Clock-domain ms at which tick 0 is due (countdown rounded up to a loop boundary). */
  startAt: number;
  inputDelay: number;
  timeLimitTicks: number;
  /** Compiled level; the match controller builds the referee sim from `level` + `seed` + `teams`. */
  level: CompiledLevel;
  /** Builds the `start` message for a seat; `countdownMs` is the remaining countdown. */
  startMsg(player: number, countdownMs: number): StartMsg;
}

export interface Room {
  readonly code: string;
  state: RoomState;
  host: number | null;
  levelId: string;
  seats: Seat[];
  startAt: number | undefined;
  match: MatchStart | undefined;
  /** Clock-domain `now` when the room ended/closed; drives GC. */
  endedAt?: number;
  /** Current connections of seated members (single mutable source; rebound on reconnect). */
  conns(): Conn[];
}

export interface RoomManagerDeps {
  content: ServerContent;
  clock: Pick<Clock, 'boundary'>;
  now: () => number;
  inputDelay: number;
  log?: Logger;
  /** CSPRNG injection point: `[min, max)` like node:crypto randomInt. Default node:crypto. */
  randomInt?: (min: number, max: number) => number;
  /** Seam for Task 6: called once per room when lobby -> countdown. */
  onStart?: (room: Room, match: MatchStart) => void;
  /** Task 6: routes `cmd`/`hash` from a seated player to the match; returns true if handled. */
  maxRooms?: number;
  /** Timer seam for the ended-room sweep. */
  timers?: { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (h: never) => void };
  onMatchMessage?: (room: Room, conn: Conn, seat: number, msg: ClientMessage) => boolean;
}

export interface RoomManager extends HubHandler {
  room(code: string): Room | undefined;
  roomOf(conn: Conn): Room | undefined;
  roomCount(): number;
  runningCount(): number;
  /** Drops ended/closed rooms older than the TTL and frees their players. */
  gc(): void;
  /** Removes a room and frees its players immediately. */
  drop(room: Room): void;
}

export function createRoomManager(deps: RoomManagerDeps): RoomManager {
  const { content, log } = deps;
  const rand = deps.randomInt ?? cryptoRandomInt;
  const rooms = new Map<string, Room>();
  const byPlayer = new Map<string, Room>();
  const maxRooms = deps.maxRooms ?? Infinity;
  let matchSeq = 0;

  const defaultLevelId = content.pvpLevelIds[0];

  const defaultSeats = (levelId: string): Seat[] => {
    const level = content.compiled[levelId]!;
    return level.players.map((p, i): Seat => ({ kind: 'human', team: p.team ?? i }));
  };

  const newCode = (): string | undefined => {
    for (let t = 0; t < MAX_CODE_TRIES; t++) {
      let c = '';
      for (let i = 0; i < CODE_LENGTH; i++) c += CODE_ALPHABET[rand(0, CODE_ALPHABET.length)]!;
      if (!rooms.has(c)) return c;
    }
    return undefined;
  };

  /** Host is implicitly ready (only non-hosts send lobby.ready). */
  const isReady = (room: Room, i: number): boolean => {
    const o = room.seats[i]?.occupant;
    return o !== undefined && (i === room.host || o.ready);
  };

  const lobbyState = (room: Room): ServerMessage => {
    const level = content.compiled[room.levelId]!;
    const seats: LobbySeat[] = room.seats.map((s, i) => {
      const out: LobbySeat = { kind: s.kind, team: s.team };
      if (s.difficulty !== undefined) out.difficulty = s.difficulty;
      if (s.occupant !== undefined) out.occupant = { nick: s.occupant.nick, ready: isReady(room, i), status: 'connected' };
      return out;
    });
    return { t: 'lobby.state', levelId: room.levelId, timeLimitSec: level.timeLimitSec ?? 0, host: room.host, seats, spectators: 0 };
  };

  const broadcast = (room: Room): void => { const m = lobbyState(room); for (const c of room.conns()) c.send(m); };

  const seatOf = (room: Room, conn: Conn): number => room.seats.findIndex((s) => s.occupant?.playerId === conn.playerId);

  const seat = (room: Room, conn: Conn, i: number): void => {
    room.seats[i]!.occupant = { playerId: conn.playerId!, nick: conn.nick, ready: false, conn };
    byPlayer.set(conn.playerId!, room);
  };

  const create_ = (conn: Conn): void => {
    if (byPlayer.has(conn.playerId!)) return conn.sendError('bad-lobby', 'already in a room');
    if (defaultLevelId === undefined) return conn.sendError('internal', 'no pvp levels');
    if (rooms.size >= maxRooms) return conn.sendError('room-full', 'server at room capacity');
    const code = newCode();
    if (code === undefined) return conn.sendError('internal', 'no free room code');
    const room: Room = {
      code, state: 'lobby', host: 0, levelId: defaultLevelId, seats: defaultSeats(defaultLevelId), startAt: undefined, match: undefined,
      conns: () => room.seats.flatMap((s) => (s.occupant ? [s.occupant.conn] : [])),
    };
    rooms.set(code, room);
    seat(room, conn, 0);
    log?.info('room.create', { room: code, levelId: room.levelId });
    conn.send({ t: 'room.joined', code, you: { seat: 0, host: true } });
    conn.send(lobbyState(room));
  };

  const join = (conn: Conn, code: string, role: 'play' | 'watch'): void => {
    if (byPlayer.has(conn.playerId!)) return conn.sendError('bad-lobby', 'already in a room');
    const room = rooms.get(code);
    if (room === undefined) return conn.sendError('room-not-found');
    if (role === 'watch') return conn.sendError('bad-lobby', 'spectating not supported yet'); // M2
    if (room.state !== 'lobby') return conn.sendError('match-in-progress');
    const i = room.seats.findIndex((s) => s.kind === 'human' && s.occupant === undefined);
    if (i < 0) return conn.sendError('room-full');
    seat(room, conn, i);
    log?.info('room.join', { room: code, seat: i, nick: conn.nick });
    conn.send({ t: 'room.joined', code, you: { seat: i, host: false } });
    broadcast(room);
  };

  const leave = (conn: Conn): void => {
    const room = byPlayer.get(conn.playerId ?? '');
    if (room === undefined) return;
    // Countdown/running leave handling belongs to the disconnect FSM (M2); lobby and ended only here.
    if (room.state === 'closed') { drop(room); return; }
    if (room.state !== 'lobby' && room.state !== 'ended') return;
    const i = seatOf(room, conn);
    if (i >= 0) { delete room.seats[i]!.occupant; }
    byPlayer.delete(conn.playerId!);
    if (!room.seats.some((s) => s.occupant)) {
      rooms.delete(room.code);
      if (room.state === 'lobby') room.state = 'closed';
      log?.info('room.close', { room: room.code, reason: 'empty' });
      return;
    }
    if (room.state === 'ended') return;
    if (room.host === i) room.host = room.seats.findIndex((s) => s.occupant !== undefined); // simple transfer; R12 refines in M2
    for (const s of room.seats) if (s.occupant) s.occupant.ready = false;
    broadcast(room);
  };

  const sameConfig = (a: SeatConfig, b: SeatConfig): boolean => a.kind === b.kind && a.team === b.team;

  const update = (conn: Conn, room: Room, msg: Extract<ClientMessage, { t: 'lobby.update' }>): void => {
    if (room.host !== seatOf(room, conn)) return conn.sendError('not-host');
    if (room.state !== 'lobby') return conn.sendError('match-in-progress');
    if (!content.pvpLevelIds.includes(msg.levelId)) return conn.sendError('bad-lobby', 'unknown level');
    // M1: seat edits are not supported; seats must equal the level defaults. M2 (Task 11) lifts this.
    const want = defaultSeats(msg.levelId);
    if (msg.seats.length !== want.length || !msg.seats.every((s, i) => sameConfig(s, want[i]!))) {
      return conn.sendError('bad-lobby', 'seat edits not supported yet');
    }
    if (msg.levelId !== room.levelId) {
      const occ = room.seats.flatMap((s) => (s.occupant ? [s.occupant] : []));
      if (occ.length > want.length) return conn.sendError('bad-lobby', 'too many players for level');
      // Level change resets seats to defaults; occupants refill in seat order with ready cleared (host stays seat 0).
      const hostOcc = room.seats[room.host!]!.occupant!;
      const rest = occ.filter((o) => o !== hostOcc);
      room.levelId = msg.levelId;
      room.seats = want;
      [hostOcc, ...rest].forEach((o, i) => { o.ready = false; room.seats[i]!.occupant = o; });
      room.host = 0;
      log?.info('lobby.level', { room: room.code, levelId: room.levelId });
    }
    broadcast(room);
  };

  const ready = (conn: Conn, room: Room, ready_: boolean): void => {
    const i = seatOf(room, conn);
    if (i < 0) return conn.sendError('not-in-room');
    if (room.state !== 'lobby') return conn.sendError('match-in-progress');
    if (i === room.host) return conn.sendError('bad-lobby', 'host is implicitly ready');
    room.seats[i]!.occupant!.ready = ready_;
    broadcast(room);
  };

  const start = (conn: Conn, room: Room): void => {
    if (room.host !== seatOf(room, conn)) return conn.sendError('not-host');
    if (room.state !== 'lobby') return conn.sendError('match-in-progress');
    for (let i = 0; i < room.seats.length; i++) {
      const s = room.seats[i]!;
      if (s.kind === 'empty' || (s.kind === 'human' && s.occupant === undefined)) return conn.sendError('bad-lobby', 'seats not filled');
      if (s.kind === 'human' && !isReady(room, i)) return conn.sendError('not-ready');
    }
    const level = content.compiled[room.levelId]!;
    const seed = rand(0, MAX_INT + 1);
    const teams = room.seats.map((s) => s.team);
    const matchId = `${room.code}-${++matchSeq}`;
    const startAt = deps.clock.boundary(deps.now() + COUNTDOWN_MS);
    const seats: StartSeat[] = room.seats.map((s, player) => {
      const o: StartSeat = { player, kind: s.kind, team: s.team, nick: s.occupant?.nick ?? '' };
      if (s.difficulty !== undefined) o.difficulty = s.difficulty;
      return o;
    });
    const timeLimitTicks = (level.timeLimitSec ?? 0) * TICK_RATE;
    /** Wire simHash is 16 hex: prefix of the compiled level's identity hash `level.simHash`. */
    const simHash = level.simHash.slice(0, 16);
    room.state = 'countdown';
    room.startAt = startAt;
    const levelId = room.levelId;
    const startMsg = (youPlayer: number, countdownMs: number): StartMsg => ({
      t: 'start', matchId, levelId, simHash, seed, seats, youPlayer,
      inputDelay: deps.inputDelay, countdownMs, timeLimitTicks, hashInterval: HASH_INTERVAL,
    });
    const match: MatchStart = { code: room.code, matchId, levelId, seed, teams, seats, startAt, inputDelay: deps.inputDelay, timeLimitTicks, level, startMsg };
    room.match = match;
    room.seats.forEach((s, i) => { s.occupant?.conn.send(startMsg(i, COUNTDOWN_MS)); });
    log?.info('room.start', { room: room.code, matchId, levelId: room.levelId, startAt });
    deps.onStart?.(room, match);
  };

  const drop = (room: Room): void => {
    rooms.delete(room.code);
    for (const s of room.seats) if (s.occupant && byPlayer.get(s.occupant.playerId) === room) byPlayer.delete(s.occupant.playerId);
    log?.info('room.gc', { room: room.code, state: room.state });
  };

  const gc = (): void => {
    const t = deps.now();
    for (const room of [...rooms.values()]) {
      if ((room.state === 'ended' || room.state === 'closed') && room.endedAt !== undefined && t - room.endedAt >= ENDED_ROOM_TTL_MS) drop(room);
    }
  };

  const timers = deps.timers ?? {
    setTimeout: (fn: () => void, ms: number) => { const h = setTimeout(fn, ms); h.unref(); return h; },
    clearTimeout: (h: never) => clearTimeout(h),
  };
  const sweep = (): void => { try { gc(); } finally { timers.setTimeout(sweep, SWEEP_MS); } };
  timers.setTimeout(sweep, SWEEP_MS);

  return {
    gc,
    drop,
    resume(conn) {
      const room = byPlayer.get(conn.playerId ?? '');
      if (room === undefined) return undefined;
      const i = seatOf(room, conn);
      return i < 0 ? undefined : { code: room.code, seat: i };
    },
    /** Rebinds a reconnecting/superseding conn to its seat and replays room state. */
    onAuthed(conn) {
      const room = byPlayer.get(conn.playerId ?? '');
      if (room === undefined) return;
      const i = seatOf(room, conn);
      if (i < 0) return;
      room.seats[i]!.occupant!.conn = conn;
      conn.send({ t: 'room.joined', code: room.code, you: { seat: i, host: room.host === i } });
      conn.send(lobbyState(room));
      if ((room.state === 'countdown' || room.state === 'running') && room.match !== undefined) {
        conn.send(room.match.startMsg(i, Math.max(0, room.match.startAt - deps.now())));
      }
    },
    room: (code) => rooms.get(code),
    roomOf: (conn) => byPlayer.get(conn.playerId ?? ''),
    roomCount: () => rooms.size,
    runningCount: () => { let n = 0; for (const r of rooms.values()) if (r.state === 'running') n++; return n; },
    onClientMessage(conn, msg) {
      switch (msg.t) {
        case 'room.create': return create_(conn);
        case 'room.join': return join(conn, msg.code, msg.role);
        case 'room.leave': return leave(conn);
        case 'lobby.update': case 'lobby.ready': case 'lobby.start': {
          const room = byPlayer.get(conn.playerId!);
          if (room === undefined) return conn.sendError('not-in-room');
          if (msg.t === 'lobby.update') return update(conn, room, msg);
          if (msg.t === 'lobby.ready') return ready(conn, room, msg.ready);
          return start(conn, room);
        }
        case 'cmd': case 'hash': {
          const room = byPlayer.get(conn.playerId!);
          const i = room === undefined ? -1 : seatOf(room, conn);
          if (room === undefined || i < 0) return conn.sendError('not-your-seat');
          if (deps.onMatchMessage?.(room, conn, i, msg)) return;
          return conn.sendError('internal', 'not supported yet');
        }
        default: return conn.sendError('internal', 'not supported yet'); // ping/rematch/resync: later tasks
      }
    },
    onDisconnect(conn, reason) {
      // Superseded = same player on a new socket; onAuthed rebinds, so keep the seat.
      if (reason === 'superseded' || conn.playerId === undefined) return;
      const room = byPlayer.get(conn.playerId);
      if (room === undefined) return;
      // Ignore a stale conn that is no longer the seat's current conn.
      const o = room.seats.find((s) => s.occupant?.playerId === conn.playerId)?.occupant;
      if (o !== undefined && o.conn !== conn) return;
      if (room.state === 'countdown' || room.state === 'running') {
        // Disconnect FSM is M2; for now an abandoned match (everyone gone) is closed so it stops ticking.
        if (room.conns().every((c) => c.closed)) {
          room.state = 'closed'; room.endedAt = deps.now();
          log?.info('room.close', { room: room.code, reason: 'abandoned' });
          drop(room);
        }
        return;
      }
      leave(conn);
    },
  };
}
