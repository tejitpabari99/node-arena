import { randomInt as cryptoRandomInt } from 'node:crypto';
import { TICK_RATE } from '@node-arena/sim';
import type { CompiledLevel } from '@node-arena/content';
import {
  HASH_INTERVAL, MAX_INT, RateLimiter, type ClientMessage, type LobbySeat, type SeatConfig, type ServerMessage, type StartMsg, type StartSeat,
} from '@node-arena/net';
import type { Clock } from './clock.js';
import type { Conn } from './conn.js';
import { CLOSE_RATE_LIMITED } from './limits.js';
import type { HubHandler } from './hub.js';
import type { Logger } from './log.js';
import type { ServerContent } from './content.js';

/** 31 unambiguous chars (no 0 O 1 I L); matches net's `^[A-Z0-9]{4}$`. 31^4 = 923,521 codes. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 4;
export const COUNTDOWN_MS = 3000;
export const MAX_SPECTATORS = 8;
export const ENDED_ROOM_TTL_MS = 10 * 60_000;
/** A lobby whose seated humans have no open socket is dropped after this (>= the 30 s seat reserve, SP07). */
export const LOBBY_EMPTY_TTL_MS = 2 * 60_000;
/** Hard match cap = time limit + this; unlimited (limit 0) matches have no cap here. */
export const MATCH_CAP_EXTRA_MS = 2 * 60_000;
/** A dropped lobby human's seat stays reserved this long for a token reconnect, then is freed (SP07 P13). */
export const SEAT_RESERVE_MS = 30_000;
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
  startMsg(player: number | null, countdownMs: number): StartMsg;
}

export interface Room {
  readonly code: string;
  state: RoomState;
  host: number | null;
  levelId: string;
  seats: Seat[];
  /** Occupants kicked from a seat (Task 11); Task 13 adds watch-join. Read-only observers. */
  spectators: Occupant[];
  startAt: number | undefined;
  match: MatchStart | undefined;
  /** Clock-domain `now` when the room ended/closed; drives GC. */
  endedAt?: number;
  /** Clock-domain `now` since which a lobby has had no open seated socket (GC bookkeeping). */
  emptySince?: number;
  /** Current connections of seated members (single mutable source; rebound on reconnect). */
  conns(): Conn[];
}

export const BOT_DIFFICULTIES = ['easy', 'normal', 'hard'] as const;

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
  /** Per-IP create / failed-join limits (keyed by `conn.ip`). */
  ipLimits?: import('./limits.js').IpLimits;
  /** Timer seam for the ended-room sweep. */
  timers?: { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (h: never) => void };
  /** SP07 hook: true while the room has a pending pause/disconnect deadline; such rooms are never GC-dropped (only the hard cap / shutdown / abort remove them). Default false. */
  hasPendingDeadline?: (room: Room) => boolean;
  /** Total ms the room's clock was frozen by pauses (extends the hard match cap). Default 0. */
  pausedMsOf?: (room: Room) => number;
  /** True if the seat is eliminated / pending forfeit in a running match (may leave without a quit). Default false. */
  seatOut?: (room: Room, seat: number) => boolean;
  /** Called whenever a room is removed (gc, abort, closeAll, empty): tear down per-room match state. */
  onRoomClosed?: (room: Room) => void;
  /** Current lockstep tick for `pong`; default 0. */
  tickOf?: (room: Room) => number | undefined;
  onMatchMessage?: (room: Room, conn: Conn, seat: number, msg: ClientMessage) => boolean;
  /** SP07: detected loss of a seated human's connection while running (socket close / heartbeat timeout). */
  onSeatDisconnect?: (room: Room, seat: number) => void;
  /** SP07: a seated human's conn was rebound while running (after its `start`). */
  onSeatReconnect?: (room: Room, seat: number, conn: Conn) => void;
  /** SP07: current pause snapshot for late attachers (watchers). */
  endOf?: (room: Room) => import('@node-arena/net').EndMsg | undefined;
  pauseStateOf?: (room: Room) => import('@node-arena/net').PauseStateMsg | undefined;
  /** SP07: countdown cancelled; unwind the match controller's per-room state (clock membership, sim, lockstep, pause). */
  onStartCancel?: (room: Room, match: MatchStart) => void;
  /** Sends `catchup` chunks (ticks [0, next)) to a conn; called right after its `start`, before it joins the live fan-out. */
  onCatchUp?: (room: Room, conn: Conn) => void;
}

export interface RoomManager extends HubHandler {
  room(code: string): Room | undefined;
  roomOf(conn: Conn): Room | undefined;
  roomCount(): number;
  runningCount(): number;
  /** Drops ended/closed rooms older than the TTL and frees their players. */
  gc(): void;
  /** True while the room has a pending pause/disconnect deadline (SP07). */
  hasPendingDeadline(room: Room): boolean;
  /** Removes a room and frees its players immediately. */
  drop(room: Room): void;
  /** Shutdown: sends `room.closed{reason}` to every conn in every room, marks rooms closed, and drops them. */
  closeAll(reason: string): void;
  /** Test hook: live ping-limiter entries. */
  pingLimiterSize(): number;
}

export function createRoomManager(deps: RoomManagerDeps): RoomManager {
  const { content, log } = deps;
  const rand = deps.randomInt ?? cryptoRandomInt;
  const rooms = new Map<string, Room>();
  const pingLimiter = new RateLimiter(deps.now);
  const byPlayer = new Map<string, Room>();
  const maxRooms = deps.maxRooms ?? Infinity;
  let matchSeq = 0;

  const timers = deps.timers ?? {
    setTimeout: (fn: () => void, ms: number) => { const h = setTimeout(fn, ms); h.unref(); return h; },
    clearTimeout: (h: never) => clearTimeout(h),
  };
  /** Pending seat-reserve timers (lobby drop), keyed by the occupant. */
  const reserves = new WeakMap<Occupant, unknown>();
  const clearReserve = (o: Occupant): void => {
    const h = reserves.get(o);
    if (h !== undefined) { timers.clearTimeout(h as never); reserves.delete(o); }
  };

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
      if (s.occupant !== undefined) out.occupant = { nick: s.occupant.nick, ready: isReady(room, i), status: s.occupant.conn.closed ? 'grace' : 'connected' };
      return out;
    });
    return { t: 'lobby.state', levelId: room.levelId, timeLimitSec: level.timeLimitSec ?? 0, host: room.host, seats, spectators: room.spectators.length };
  };

  const broadcast = (room: Room): void => { const m = lobbyState(room); for (const c of room.conns()) c.send(m); };

  /** Earliest seated human with an open socket, else null (host transfer, R12). */
  const pickHost = (room: Room): number | null => {
    const i = room.seats.findIndex((s) => s.kind === 'human' && s.occupant !== undefined && !s.occupant.conn.closed);
    return i < 0 ? null : i;
  };

  const hasPendingDeadline = (room: Room): boolean => deps.hasPendingDeadline?.(room) ?? false;

  const seatOf = (room: Room, conn: Conn): number => room.seats.findIndex((s) => s.occupant?.playerId === conn.playerId);

  const seat = (room: Room, conn: Conn, i: number): void => {
    room.seats[i]!.occupant = { playerId: conn.playerId!, nick: conn.nick, ready: false, conn };
    byPlayer.set(conn.playerId!, room);
  };

  const create_ = (conn: Conn): void => {
    if (byPlayer.has(conn.playerId!)) return conn.sendError('bad-lobby', 'already in a room');
    if (conn.ip !== undefined && deps.ipLimits?.allowCreate(conn.ip) === false) return conn.sendError('rate-limited', 'too many rooms created');
    if (defaultLevelId === undefined) return conn.sendError('internal', 'no pvp levels');
    if (rooms.size >= maxRooms) return conn.sendError('room-full', 'server at room capacity');
    const code = newCode();
    if (code === undefined) return conn.sendError('internal', 'no free room code');
    const room: Room = {
      code, state: 'lobby', host: 0, levelId: defaultLevelId, seats: defaultSeats(defaultLevelId), spectators: [], startAt: undefined, match: undefined,
      conns: () => [...room.seats.flatMap((s) => (s.occupant ? [s.occupant.conn] : [])), ...room.spectators.map((o) => o.conn)],
    };
    rooms.set(code, room);
    seat(room, conn, 0);
    log?.info('room.create', { room: code, levelId: room.levelId });
    conn.send({ t: 'room.joined', code, you: { seat: 0, host: true } });
    conn.send(lobbyState(room));
  };

  /**
   * Reusable mid-match attach (SP07 reconnect reuses it for seated players): `start` (youPlayer) then catch-up chunks,
   * all synchronous so the caller can add the conn to the live fan-out in the same turn with no tick gap.
   */
  const attachMidMatch = (room: Room, conn: Conn, youPlayer: number | null, alwaysPause = false): void => {
    conn.send(room.match!.startMsg(youPlayer, Math.max(0, room.match!.startAt - deps.now())));
    deps.onCatchUp?.(room, conn);
    const p = deps.pauseStateOf?.(room);
    if (p !== undefined && (p.paused || alwaysPause)) conn.send(p);
    const end = deps.endOf?.(room);
    if (end !== undefined) conn.send(end);
  };

  const catchUpAllowed = (conn: Conn): boolean => deps.ipLimits?.allowCatchUp(conn.playerId!, conn.ip) ?? true;

  const watch = (conn: Conn, room: Room): void => {
    if (room.state !== 'lobby' && room.state !== 'countdown' && room.state !== 'running') return conn.sendError('match-in-progress');
    if (room.spectators.length >= MAX_SPECTATORS) return conn.sendError('spectators-full');
    if (room.state !== 'lobby' && room.match !== undefined && !catchUpAllowed(conn)) return conn.sendError('rate-limited', 'catch-up too frequent');
    conn.send({ t: 'room.joined', code: room.code, you: { seat: null, host: false } });
    if (room.state !== 'lobby' && room.match !== undefined) {
      conn.send(lobbyState(room));
      attachMidMatch(room, conn, null);
    }
    room.spectators.push({ playerId: conn.playerId!, nick: conn.nick, ready: false, conn });
    byPlayer.set(conn.playerId!, room);
    log?.info('room.watch', { room: room.code, nick: conn.nick, spectators: room.spectators.length });
    if (room.state === 'lobby') broadcast(room);
  };

  const join = (conn: Conn, code: string, role: 'play' | 'watch'): void => {
    if (byPlayer.has(conn.playerId!)) return conn.sendError('bad-lobby', 'already in a room');
    if (conn.ip !== undefined && deps.ipLimits?.joinBlocked(conn.ip) === true) return conn.sendError('rate-limited', 'too many failed joins');
    const room = rooms.get(code);
    if (room === undefined) {
      if (conn.ip !== undefined) deps.ipLimits?.failedJoin(conn.ip);
      return conn.sendError('room-not-found');
    }
    if (role === 'watch') return watch(conn, room);
    if (room.state !== 'lobby') return conn.sendError('match-in-progress');
    const i = room.seats.findIndex((s) => s.kind === 'human' && s.occupant === undefined);
    if (i < 0) return conn.sendError('room-full');
    seat(room, conn, i);
    room.host ??= pickHost(room); // hostless lobby (sole host dropped): the joiner is promoted
    log?.info('room.join', { room: code, seat: i, nick: conn.nick });
    conn.send({ t: 'room.joined', code, you: { seat: i, host: room.host === i } });
    broadcast(room);
  };

  /** Countdown -> lobby with full unwind: match/startAt cleared, controller state dropped, ready cleared, `start.cancel` then `lobby.state`. */
  const cancelCountdown = (room: Room, rebroadcast = true): void => {
    const match = room.match;
    if (room.state !== 'countdown' || match === undefined) return;
    deps.onStartCancel?.(room, match);
    room.state = 'lobby';
    room.match = undefined;
    room.startAt = undefined;
    for (const s of room.seats) if (s.occupant) s.occupant.ready = false;
    const m: ServerMessage = { t: 'start.cancel', matchId: match.matchId };
    for (const c of room.conns()) c.send(m);
    log?.info('room.start.cancel', { room: room.code, matchId: match.matchId });
    if (rebroadcast) broadcast(room);
  };

  /** Lobby human lost their socket: keep the seat SEAT_RESERVE_MS for a token reconnect, pass host on, then free it. */
  const reserveSeat = (room: Room, i: number): void => {
    const o = room.seats[i]!.occupant!;
    clearReserve(o);
    if (room.host === i) {
      room.host = pickHost(room);
      for (const s of room.seats) if (s.occupant) s.occupant.ready = false; // host passed: ready flags reset
    }
    reserves.set(o, timers.setTimeout(() => {
      reserves.delete(o);
      // Find the occupant by identity: a host level change / seat flip may have moved it off index i.
      const held = room.seats.some((s) => s.occupant === o) || room.spectators.includes(o);
      if ((room.state === 'lobby' || room.state === 'ended') && held && o.conn.closed) leave(o.conn);
    }, SEAT_RESERVE_MS));
  };

  const leave = (conn: Conn): void => {
    const room = byPlayer.get(conn.playerId ?? '');
    if (room === undefined) return;
    if (room.state === 'closed') { drop(room); return; }
    const i = seatOf(room, conn);
    // Countdown: a seated leave cancels the start (full unwind), then the seat is freed like a lobby leave.
    if (i >= 0 && room.state === 'countdown') cancelCountdown(room, false);
    // Running: a seated leave is a quit (pending Forfeit; client confirms first).
    if (i >= 0 && room.state === 'running') {
      if (deps.seatOut?.(room, i) === true) { // eliminated / forfeited: unbind only; seat + sim state untouched
        delete room.seats[i]!.occupant;
        byPlayer.delete(conn.playerId!);
        return;
      }
      deps.onMatchMessage?.(room, conn, i, { t: 'quit' });
      return;
    }
    if (i < 0) { // spectators may leave any time
      room.spectators = room.spectators.filter((o) => o.playerId !== conn.playerId);
      byPlayer.delete(conn.playerId!);
      if (room.state === 'lobby') broadcast(room);
      return;
    }
    if (room.state !== 'lobby' && room.state !== 'ended') return;
    if (i >= 0) { clearReserve(room.seats[i]!.occupant!); delete room.seats[i]!.occupant; }
    else room.spectators = room.spectators.filter((o) => o.playerId !== conn.playerId);
    byPlayer.delete(conn.playerId!);
    if (i < 0) { if (room.state === 'lobby') broadcast(room); return; }
    if (!room.seats.some((s) => s.occupant)) {
      for (const o of room.spectators) byPlayer.delete(o.playerId);
      room.spectators = [];
      rooms.delete(room.code);
      if (room.state === 'lobby') room.state = 'closed';
      deps.onRoomClosed?.(room);
      log?.info('room.close', { room: room.code, reason: 'empty' });
      return;
    }
    if (room.host === i || room.host === null) room.host = pickHost(room);
    for (const s of room.seats) if (s.occupant) s.occupant.ready = false;
    if (room.state === 'lobby') broadcast(room);
  };

  /** Normalises one wire seat: difficulty only on bots (default normal); returns undefined if invalid. */
  const normSeat = (s: SeatConfig, n: number): SeatConfig | undefined => {
    if (!Number.isInteger(s.team) || s.team < 0 || s.team >= n) return undefined;
    if (s.kind !== 'bot') return s.difficulty === undefined ? { kind: s.kind, team: s.team } : undefined;
    const difficulty = s.difficulty ?? 'normal';
    if (!(BOT_DIFFICULTIES as readonly string[]).includes(difficulty)) return undefined;
    return { kind: 'bot', team: s.team, difficulty };
  };

  const update = (conn: Conn, room: Room, msg: Extract<ClientMessage, { t: 'lobby.update' }>): void => {
    const hostSeat = seatOf(room, conn);
    if (room.host !== hostSeat) return conn.sendError('not-host');
    if (room.state !== 'lobby') return conn.sendError('match-in-progress');
    if (!content.pvpLevelIds.includes(msg.levelId)) return conn.sendError('bad-lobby', 'unknown level');
    if (msg.levelId !== room.levelId) {
      // Level change resets seats to defaults (msg.seats ignored); occupants refill in seat order, ready cleared, host -> seat 0.
      const want = defaultSeats(msg.levelId);
      const occ = room.seats.flatMap((s) => (s.occupant ? [s.occupant] : []));
      if (occ.length > want.length) return conn.sendError('bad-lobby', 'too many players for level');
      const hostOcc = room.seats[room.host!]!.occupant!;
      const rest = occ.filter((o) => o !== hostOcc);
      room.levelId = msg.levelId;
      room.seats = want;
      [hostOcc, ...rest].forEach((o, i) => { o.ready = false; room.seats[i]!.occupant = o; });
      room.host = 0;
      log?.info('lobby.level', { room: room.code, levelId: room.levelId });
      return broadcast(room);
    }
    const n = room.seats.length;
    if (msg.seats.length !== n) return conn.sendError('bad-lobby', 'seat count must match level');
    const next: SeatConfig[] = [];
    for (const raw of msg.seats) {
      const s = normSeat(raw, n);
      if (s === undefined) return conn.sendError('bad-lobby', 'invalid seat');
      next.push(s);
    }
    if (next[hostSeat]!.kind !== 'human') return conn.sendError('bad-lobby', 'host seat must be human');
    let changed = false;
    next.forEach((c, i) => {
      const cur = room.seats[i]!;
      if (cur.kind === c.kind && cur.team === c.team && cur.difficulty === c.difficulty) return;
      changed = true;
      if (cur.occupant !== undefined && c.kind !== 'human') { // occupied human seat flipped away: occupant -> spectator
        room.spectators.push(cur.occupant);
        delete cur.occupant;
      }
      const out: Seat = { kind: c.kind, team: c.team, ...(cur.occupant ? { occupant: cur.occupant } : {}) };
      if (c.difficulty !== undefined) out.difficulty = c.difficulty;
      room.seats[i] = out;
    });
    if (changed) for (const s of room.seats) if (s.occupant) s.occupant.ready = false;
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
      if (s.kind === 'human' && s.occupant!.conn.closed) return conn.sendError('bad-lobby', 'a seated player is disconnected');
    }
    if (new Set(room.seats.map((s) => s.team)).size < 2) return conn.sendError('bad-lobby', 'needs at least 2 distinct teams');
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
    const startMsg = (youPlayer: number | null, countdownMs: number): StartMsg => ({
      t: 'start', matchId, levelId, simHash, seed, seats, youPlayer,
      inputDelay: deps.inputDelay, countdownMs, timeLimitTicks, hashInterval: HASH_INTERVAL,
    });
    const match: MatchStart = { code: room.code, matchId, levelId, seed, teams, seats, startAt, inputDelay: deps.inputDelay, timeLimitTicks, level, startMsg };
    room.match = match;
    room.seats.forEach((s, i) => { s.occupant?.conn.send(startMsg(i, COUNTDOWN_MS)); });
    for (const o of room.spectators) o.conn.send(startMsg(null, COUNTDOWN_MS)); // lobby watchers: live from tick 0, no catch-up
    log?.info('room.start', { room: room.code, matchId, levelId: room.levelId, startAt });
    deps.onStart?.(room, match);
  };

  /** Seated human back to lobby after `end`: same setup, ready cleared (sender ready), new seed on next start, spectators kept. */
  const rematch = (conn: Conn): void => {
    const room = byPlayer.get(conn.playerId ?? '');
    if (room === undefined) return conn.sendError('not-in-room');
    const i = seatOf(room, conn);
    if (i < 0) return conn.sendError('not-your-seat');
    if (room.state === 'lobby') { // second player's click after the room already reset: just ready up
      if (i !== room.host) room.seats[i]!.occupant!.ready = true;
      return broadcast(room);
    }
    if (room.state !== 'ended') return conn.sendError('match-in-progress');
    room.state = 'lobby';
    room.match = undefined;
    room.startAt = undefined;
    delete room.endedAt;
    delete room.emptySince;
    for (const s of room.seats) if (s.occupant) s.occupant.ready = false;
    room.seats[i]!.occupant!.ready = true;
    const h = room.host;
    if (h === null || room.seats[h]?.occupant === undefined || room.seats[h]!.occupant!.conn.closed) room.host = i;
    log?.info('room.rematch', { room: room.code, by: i });
    broadcast(room);
  };

  const notifyClosed = (room: Room, reason: string): void => {
    for (const c of room.conns()) if (!c.closed) c.send({ t: 'room.closed', reason });
  };

  const drop = (room: Room): void => {
    rooms.delete(room.code);
    for (const s of room.seats) if (s.occupant && byPlayer.get(s.occupant.playerId) === room) byPlayer.delete(s.occupant.playerId);
    for (const o of room.spectators) if (byPlayer.get(o.playerId) === room) byPlayer.delete(o.playerId);
    log?.info('room.gc', { room: room.code, state: room.state });
    deps.onRoomClosed?.(room);
  };

  const gc = (): void => {
    const t = deps.now();
    for (const room of [...rooms.values()]) {
      // A paused room is off the clock: never capped (unlimited sole-human pause ends via the D14 idle close). Cap also grows by past paused time.
      if (hasPendingDeadline(room)) continue;
      if ((room.state === 'countdown' || room.state === 'running') && room.match !== undefined && room.match.timeLimitTicks > 0
        && t >= room.match.startAt + (room.match.timeLimitTicks * 1000) / TICK_RATE + MATCH_CAP_EXTRA_MS + (deps.pausedMsOf?.(room) ?? 0)) {
        room.state = 'closed'; room.endedAt = t;
        log?.warn('room.close', { room: room.code, reason: 'match-cap' });
        notifyClosed(room, 'idle');
        drop(room);
        continue;
      }
      if ((room.state === 'ended' || room.state === 'closed') && room.endedAt !== undefined && t - room.endedAt >= ENDED_ROOM_TTL_MS) { drop(room); continue; }
      if (room.state === 'lobby') {
        // Spectator sockets do not keep a lobby alive; only seated humans' sockets do.
        if (room.seats.every((s) => s.occupant === undefined || s.occupant.conn.closed)) {
          room.emptySince ??= t;
          if (t - room.emptySince >= LOBBY_EMPTY_TTL_MS) { log?.info('room.close', { room: room.code, reason: 'empty-lobby' }); notifyClosed(room, 'idle'); room.state = 'closed'; drop(room); }
        } else delete room.emptySince;
      }
    }
  };

  const sweep = (): void => { try { gc(); } finally { timers.setTimeout(sweep, SWEEP_MS); } };
  timers.setTimeout(sweep, SWEEP_MS);

  return {
    gc,
    hasPendingDeadline,
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
      clearReserve(room.seats[i]!.occupant!);
      room.seats[i]!.occupant!.conn = conn;
      if (room.host === null && (room.state === 'lobby' || room.state === 'ended')) room.host = i; // returning member of a hostless room
      conn.send({ t: 'room.joined', code: room.code, you: { seat: i, host: room.host === i } });
      conn.send(lobbyState(room));
      if (room.state === 'countdown' && room.match !== undefined) conn.send(room.match.startMsg(i, Math.max(0, room.match.startAt - deps.now())));
      else if ((room.state === 'running' || room.state === 'ended') && room.match !== undefined) {
        // start -> catchup(0..next, last done) -> pause.state (if paused) -> stored end, all synchronous.
        // Hold bookkeeping first (broadcast skips this conn), so the snapshot attach sends is already post-reconnect.
        if (!catchUpAllowed(conn)) { conn.sendError('rate-limited', 'catch-up too frequent'); conn.close(CLOSE_RATE_LIMITED, 'rate limited'); return; }
        if (room.state === 'running') deps.onSeatReconnect?.(room, i, conn);
        attachMidMatch(room, conn, i, room.state === 'running');
      }
    },
    /** Heartbeat silence: treat as a disconnect now (the socket close may lag on a dead TCP link). */
    onHeartbeatTimeout(conn) {
      const room = byPlayer.get(conn.playerId ?? '');
      if (room === undefined || (room.state !== 'running' && room.state !== 'countdown')) return;
      const i = seatOf(room, conn);
      if (i < 0 || room.seats[i]!.occupant!.conn !== conn) return;
      if (room.state === 'countdown') { cancelCountdown(room); return; } // away before tick 0: cancel (the close that follows reserves the seat)
      deps.onSeatDisconnect?.(room, i);
    },
    room: (code) => rooms.get(code),
    roomOf: (conn) => byPlayer.get(conn.playerId ?? ''),
    roomCount: () => rooms.size,
    closeAll(reason) {
      for (const room of [...rooms.values()]) { notifyClosed(room, reason); room.state = 'closed'; drop(room); }
    },
    pingLimiterSize: () => pingLimiter.size,
    runningCount: () => { let n = 0; for (const r of rooms.values()) if (r.state === 'running') n++; return n; },
    onClientMessage(conn, msg) {
      switch (msg.t) {
        case 'room.create': return create_(conn);
        case 'room.join': return join(conn, msg.code, msg.role);
        case 'room.leave': return leave(conn);
        case 'rematch': return rematch(conn);
        case 'lobby.update': case 'lobby.ready': case 'lobby.start': {
          const room = byPlayer.get(conn.playerId!);
          if (room === undefined) return conn.sendError('not-in-room');
          if (msg.t === 'lobby.update') return update(conn, room, msg);
          if (msg.t === 'lobby.ready') return ready(conn, room, msg.ready);
          return start(conn, room);
        }
        case 'cmd': case 'hash': case 'pause': case 'resume': case 'quit': {
          const room = byPlayer.get(conn.playerId!);
          const i = room === undefined ? -1 : seatOf(room, conn);
          if (room === undefined || i < 0) return conn.sendError(room === undefined && msg.t !== 'cmd' && msg.t !== 'hash' ? 'no-match' : 'not-your-seat');
          if (msg.t === 'quit' && room.state === 'countdown') return cancelCountdown(room); // quit before tick 0 cancels to lobby
          if (deps.onMatchMessage?.(room, conn, i, msg)) return;
          return conn.sendError('internal', 'not supported yet');
        }
        case 'ping': {
          const v = pingLimiter.hit(conn.id, 'ping');
          if (!v.ok) {
            conn.sendError('rate-limited');
            if (v.advice === 'disconnect') conn.close(CLOSE_RATE_LIMITED, 'rate limited');
            return;
          }
          const room = byPlayer.get(conn.playerId!);
          return conn.send({ t: 'pong', id: msg.id, tick: (room === undefined ? undefined : deps.tickOf?.(room)) ?? 0 });
        }
        default: return conn.sendError('internal', 'not supported yet'); // rematch/resync: later tasks
      }
    },
    onDisconnect(conn, reason) {
      pingLimiter.reset(conn.id);
      // Superseded = same player on a new socket; onAuthed rebinds, so keep the seat.
      if (reason === 'superseded' || conn.playerId === undefined) return;
      const room = byPlayer.get(conn.playerId);
      if (room === undefined) return;
      // Ignore a stale conn that is no longer the seat's current conn.
      const o = room.seats.find((s) => s.occupant?.playerId === conn.playerId)?.occupant;
      if (o !== undefined && o.conn !== conn) return;
      if (o === undefined) { leave(conn); return; } // spectator: just drop them
      if (room.state === 'running') { deps.onSeatDisconnect?.(room, seatOf(room, conn)); return; } // never closed here; SP07 deadlines / hard cap end it
      if (room.state === 'countdown') { reserveSeat(room, seatOf(room, conn)); cancelCountdown(room); return; }
      if (room.state === 'lobby') { reserveSeat(room, seatOf(room, conn)); broadcast(room); return; }
      if (room.state === 'ended') { reserveSeat(room, seatOf(room, conn)); return; } // keep binding + stored end for a token reconnect (until reserve/GC/rematch)
      leave(conn);
    },
  };
}
