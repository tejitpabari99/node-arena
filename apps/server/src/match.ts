import { BOT_PRESETS, createSeatDriver, type BotDifficulty } from '@node-arena/bots';
import { create, type Sim } from '@node-arena/sim';
import { encodeTick, encode, endMessage, HASH_INTERVAL, LAG_BUFFER_BYTES, LagFeed, LockstepServer, SYSTEM_CMD_RESERVE, type ClientMessage, type EndMsg, type PauseStateMsg, type SeatKind } from '@node-arena/net';
import type { Clock, ClockRoom } from './clock.js';
import type { Conn } from './conn.js';
import { BACKPRESSURE_CLOSE_BYTES, CLOSE_BACKPRESSURE, CLOSE_RATE_LIMITED } from './limits.js';
import type { Logger } from './log.js';
import { createPause, type PauseModule } from './pause.js';
import type { MatchStart, Room } from './room.js';

export const DESYNC_MIN_GAP_MS = 10_000;
/** Max accepted `cmd`s per seat per target tick; excess gets `rate-limited` (full token bucket is M2). */
export const MAX_CMDS_PER_SEAT_PER_TICK = 8;

export interface MatchDeps {
  clock: Pick<Clock, 'add' | 'remove'> & Partial<Pick<Clock, 'boundary'>>;
  /** Timer seam for pause deadlines (default: global timers, unref'd). */
  timers?: { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (h: unknown) => void };
  now: () => number;
  log?: Logger;
  /** Called after an aborted room has notified its players; frees the room and its players. */
  onAbort?: (room: Room) => void;
  /** Test seam: bot commands for this tick (empty in M1). */
  botCommands?: (match: MatchStart) => readonly import('@node-arena/defs').Command[];
}

export interface MatchController {
  onStart(room: Room, match: MatchStart): void;
  /** Routes `cmd` / `hash` / `pause` / `resume` / `quit` from a seated player. Returns false if the message is not match-related. */
  onMessage(room: Room, conn: Conn, seat: number, msg: ClientMessage): boolean;
  /** Sends the room's logged ticks [0, next) to `conn` as `catchup` chunks (<=2000 ticks each, last `done`). Sync; reusable for reconnect. */
  catchUp(room: Room, conn: Conn): void;
  /** Detected connection loss of a seated human (socket close or heartbeat timeout): opens/marks a disconnect hold. */
  onSeatDisconnect(room: Room, seat: number): void;
  /** A seat's socket was (re)bound mid-match: marks holds connected and sends the pause snapshot to `conn` while paused. */
  onSeatReconnect(room: Room, seat: number, conn: Conn): void;
  /** Stored terminal `end` (immutable once set); undefined while the match is live. */
  endOf(room: Room): EndMsg | undefined;
  /** Current pause snapshot (frozen tick = lockstep.nextTick), or undefined without a running match. */
  pauseState(room: Room): PauseStateMsg | undefined;
  /** True while any hold exists (such rooms are never GC-dropped). */
  hasPendingDeadline(room: Room): boolean;
  /** Countdown cancelled: drops clock membership, pause timers and all per-room state so nothing leaks into the next Start. */
  cancel(room: Room): void;
  /** Test-visible: the room's lockstep server (command log survives match end). */
  inspect(room: Room): LockstepServer | undefined;
  /** Test-visible: the room's referee sim. */
  simOf(room: Room): Sim | undefined;
}

/** Authoritative loop per room: referee sim + lockstep, driven by the shared clock. Never waits on clients. */
export function createMatchController(deps: MatchDeps): MatchController {
  const { clock, now, log } = deps;
  const timers = deps.timers ?? {
    setTimeout: (fn: () => void, ms: number): unknown => { const h = setTimeout(fn, ms); h.unref(); return h; },
    clearTimeout: (h: unknown): void => clearTimeout(h as never),
  };
  const servers = new WeakMap<Room, LockstepServer>();
  const sims = new WeakMap<Room, Sim>();
  // Kept after match end so late hashes are still compared against stored checkpoints.
  const active = new WeakMap<Room, { lockstep: LockstepServer; lastDesync: Map<number, number>; perTick: Map<number, { tick: number; n: number }>; total: Map<number, number>; seatBudget: number; pause: PauseModule; clockRoom: ClockRoom; clockOn: boolean; terminalClose: () => void }>();

  const feeds = new WeakMap<Room, WeakMap<Conn, LagFeed>>();
  const ends = new WeakMap<Room, EndMsg>();

  /** Live fan-out with backpressure: >256 KB buffered skips writes (batched `ticks` on drain), >2 MB closes. */
  const frameTo = (room: Room, lockstep: LockstepServer, n: number, cmds: readonly import('@node-arena/defs').Command[], frame: string): void => {
    let byConn = feeds.get(room);
    if (byConn === undefined) { byConn = new WeakMap(); feeds.set(room, byConn); }
    for (const c of room.conns()) {
      try {
        const buffered = c.socket.bufferedAmount;
        if (buffered > BACKPRESSURE_CLOSE_BYTES) { log?.warn('conn.backpressure_close', { conn: c.id, room: room.code }); c.close(CLOSE_BACKPRESSURE, 'backpressure'); continue; }
        let feed = byConn.get(c);
        if (feed === undefined) { feed = new LagFeed(lockstep.log, n); byConn.set(c, feed); }
        const out = feed.deliver(n, cmds, buffered > LAG_BUFFER_BYTES);
        if (out.length === 1 && out[0]!.t === 'tick') c.sendFrame(frame);
        else for (const m of out) c.sendFrame(encode(m));
      } catch { /* dead socket; disconnect FSM handles it later */ }
    }
  };

  const onStart = (room: Room, match: MatchStart): void => {
    let terminalClose: () => void = () => {};
    const sim = create(match.level, match.seed, { teams: match.teams });
    sims.set(room, sim);
    const kinds: SeatKind[] = room.seats.map((s) => s.kind);
    const lockstep = new LockstepServer({
      seats: kinds, inputDelay: match.inputDelay, now, buildingCount: sim.view.ids.buildings.length, log: { timeLimitTicks: match.timeLimitTicks },
    });
    servers.set(room, lockstep);
    const seatBudget = Math.max(1, Math.floor((lockstep.log.cmdCap - SYSTEM_CMD_RESERVE) / Math.max(1, kinds.length)));
    // Bot seats (R10): one driver per match; preset by lobby difficulty (unknown -> normal). Server-logged only.
    const driver = createSeatDriver(match.level, match.seed);
    match.seats.forEach((s, player) => { if (s.kind === 'bot') driver.setBot(player, BOT_PRESETS[(s.difficulty ?? 'normal') as BotDifficulty] ?? BOT_PRESETS.normal); });
    const botSpent = new Map<number, number>();
    /** Bot cmds for this tick, capped by the same per-seat budget as humans (excess dropped, deterministic, never logged). */
    const botTick = (): import('@node-arena/defs').Command[] => {
      const out: import('@node-arena/defs').Command[] = [];
      for (const c of [...driver.commands(sim), ...(deps.botCommands?.(match) ?? [])]) {
        const used = botSpent.get(c.player) ?? 0;
        if (used >= seatBudget) continue;
        botSpent.set(c.player, used + 1);
        out.push(c);
      }
      return out;
    };
    const clockRoom: ClockRoom = { startAt: match.startAt, tick: () => tick() };
    const pause = createPause({
      now, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
      seats: room.seats.map((s, player) => ({ player, kind: s.kind === 'human' ? 'human' : 'bot', team: s.team })),
      onExpire: (e) => {
        log?.info('pause.expire', { room: room.code, expired: e.expired, forfeits: e.forfeits, draw: e.draw, terminal: e.terminal });
        if (e.terminal) terminalClose(); else publish(room, entry);
      },
      // D14: sole human(s) gone with no deadline pending for 10 min -> close `idle`.
      onIdle: () => {
        if (room.state !== 'running') return;
        stop();
        room.state = 'closed';
        room.endedAt = now();
        log?.warn('room.close', { room: room.code, reason: 'idle' });
        for (const c of room.conns()) c.send({ t: 'room.closed', reason: 'idle' });
        deps.onAbort?.(room);
      },
    });
    const entry = { lockstep, lastDesync: new Map<number, number>(), perTick: new Map<number, { tick: number; n: number }>(), total: new Map<number, number>(), seatBudget, pause, clockRoom, clockOn: false, terminalClose: () => terminalClose() };
    active.set(room, entry);

    const stop = (): void => { clock.remove(clockRoom); entry.clockOn = false; pause.dispose(); };
    const abort = (err: unknown): void => {
      stop();
      room.state = 'closed';
      room.endedAt = now();
      log?.error('match.internal', { room: room.code, matchId: match.matchId, error: err instanceof Error ? err.message : String(err) });
      for (const c of room.conns()) {
        c.sendError('internal');
        c.send({ t: 'room.closed', reason: 'internal' });
      }
      deps.onAbort?.(room);
    };

    /** Close one tick (pending Forfeits first as system cmds), step the referee, fan out, and finish the match if the sim says so. */
    const runTick = (forced: boolean): void => {
      try {
        if (room.state === 'countdown') room.state = 'running';
        const botCmds = botTick();
        const system = pause.pendingForfeits().map((player) => ({ type: 'Forfeit' as const, player }));
        const { n, cmds, dropped, firstDrop } = lockstep.closeTick(botCmds, system);
        if (dropped > 0) throw new Error(`command log refused ${dropped} cmds: ${firstDrop}`);
        sim.step(cmds, { events: false });
        const elim: number[] = [];
        for (let p = 0; p < kinds.length; p++) if (sim.view.eliminatedAt[p]! >= 0) elim.push(p);
        pause.syncEliminated(elim);
        if (sim.view.tick % HASH_INTERVAL === 0) lockstep.recordCheckpoint(sim.view.tick, sim.hash());
        frameTo(room, lockstep, n, cmds, encodeTick(n, cmds));
        if (sim.view.over !== null) {
          const finalTick = sim.view.tick;
          const end = endMessage(sim.view.over, finalTick, sim.hash());
          if (end === null) throw new Error('non-pvp outcome');
          ends.set(room, end);
          const before = pause.epoch();
          pause.flush();
          room.state = 'ended';
          room.endedAt = now();
          stop();
          // Final pause.state{paused:false} always precedes `end` (P8).
          if (forced || pause.epoch() !== before) sendAll(room, pause.snapshot(lockstep.nextTick));
          for (const c of room.conns()) c.send(end);
          log?.info('match.end', { room: room.code, matchId: match.matchId, finalTick, outcome: end.outcome.outcome });
        } else if (forced) {
          throw new Error('terminal forfeit did not end the match'); // invariant violation
        }
      } catch (err) {
        abort(err);
      }
    };

    const tick = (): void => {
      if (room.state === 'ended' || room.state === 'closed' || room.state === 'lobby') { stop(); return; }
      runTick(false);
    };

    /** Terminal forfeit (quit / expiry): module already flushed. Close the frozen tick N immediately, bypassing the clock. */
    terminalClose = (): void => {
      if (room.state !== 'running') return;
      clock.remove(clockRoom);
      entry.clockOn = false;
      runTick(true);
    };
    clock.add(clockRoom);
    entry.clockOn = true;
  };

  const sendAll = (room: Room, msg: PauseStateMsg, except?: Conn): void => { for (const c of room.conns()) if (!c.closed && c !== except) c.send(msg); };

  /** Freeze/unfreeze the room's clock membership from the hold set, then broadcast the snapshot (sent before any later frame). */
  const publish = (room: Room, m: { lockstep: LockstepServer; pause: PauseModule; clockRoom: ClockRoom; clockOn: boolean }, except?: Conn): void => {
    if (room.state !== 'running') return;
    if (m.pause.paused() && m.clockOn) { clock.remove(m.clockRoom); m.clockOn = false; }
    else if (!m.pause.paused() && !m.clockOn) {
      // Resume without burst: the room re-enters the loop at the next boundary, so tick n (= frozen tick) is simply the next due tick.
      m.clockRoom.startAt = clock.boundary?.(now()) ?? now();
      clock.add(m.clockRoom);
      m.clockOn = true;
    }
    sendAll(room, m.pause.snapshot(m.lockstep.nextTick), except);
  };

  const control = (room: Room, conn: Conn, seat: number, msg: Extract<ClientMessage, { t: 'pause' | 'resume' | 'quit' }>): boolean => {
    if (room.seats[seat]?.kind !== 'human' || room.seats[seat]?.occupant?.conn !== conn) { conn.sendError('not-your-seat'); return true; }
    const m = active.get(room);
    if (room.state === 'ended' || room.state === 'closed') return true; // result is final: late control is a no-op
    if (m === undefined || room.state !== 'running') { conn.sendError('no-match'); return true; }
    const v = m.lockstep.limiter.hit(seat, 'control');
    if (!v.ok) {
      conn.sendError('rate-limited');
      if (v.advice === 'disconnect') conn.close(CLOSE_RATE_LIMITED, 'rate limited');
      return true;
    }
    if (msg.t === 'resume') {
      const r = m.pause.resume(seat, msg.epoch);
      if (r === 'resumed') { log?.info('pause.resume', { room: room.code, seat }); publish(room, m); }
      else if (r === 'none') conn.sendError('not-your-seat'); // no hold of its own: forged / already released
      return true; // 'stale': ignored
    }
    const r = msg.t === 'pause' ? m.pause.pause(seat) : m.pause.quit(seat);
    if (!r.ok) { conn.sendError(r.reason === 'paused' ? 'paused' : r.reason === 'ended' ? 'no-match' : 'not-your-seat'); return true; }
    if (msg.t === 'pause') {
      if ((r as { repeat: boolean }).repeat) conn.send(m.pause.snapshot(m.lockstep.nextTick)); // idempotent repeat by the owner
      else { log?.info('pause.open', { room: room.code, seat, reason: 'manual' }); publish(room, m); }
    } else {
      log?.info('pause.quit', { room: room.code, seat });
      if ((r as { terminal: boolean }).terminal) m.terminalClose(); else publish(room, m);
    }
    return true;
  };

  const onMessage = (room: Room, conn: Conn, seat: number, msg: ClientMessage): boolean => {
    if (msg.t === 'pause' || msg.t === 'resume' || msg.t === 'quit') return control(room, conn, seat, msg);
    if (msg.t !== 'cmd' && msg.t !== 'hash') return false;
    const m = active.get(room);
    // Late messages after end/close (in-flight final hash/cmd) are dropped silently; hashes still get compared below.
    if (m !== undefined && room.state === 'closed') return true;
    if (m !== undefined && room.state === 'ended' && msg.t === 'cmd') return true;
    if (m === undefined || (room.state !== 'running' && room.state !== 'countdown' && room.state !== 'ended')) {
      conn.sendError(msg.t === 'cmd' ? 'not-your-seat' : 'internal', 'no running match');
      return true;
    }
    if (msg.t === 'cmd') {
      // Commands only while running (not lobby/countdown), from the human seat's own connection.
      if (room.state !== 'running' || room.seats[seat]?.kind !== 'human' || room.seats[seat]?.occupant?.conn !== conn) {
        conn.sendError('not-your-seat');
        return true;
      }
      // Per-seat caps so one spammer cannot saturate the shared CommandLog (cap breach aborts the room).
      if (m.pause.paused()) { conn.sendError('paused'); return true; } // buffered pre-pause cmds keep their original ticks
      const tick = m.lockstep.nextTick + m.lockstep.inputDelay;
      const pt = m.perTick.get(seat);
      const n = pt !== undefined && pt.tick === tick ? pt.n : 0;
      const total = m.total.get(seat) ?? 0;
      if (n >= MAX_CMDS_PER_SEAT_PER_TICK || total >= m.seatBudget) {
        conn.sendError('rate-limited');
        return true;
      }
      const r = m.lockstep.submit(seat, msg.c);
      if (!r.accepted) {
        conn.sendError(r.rejected);
        if ('advice' in r && r.advice === 'disconnect') conn.close(CLOSE_RATE_LIMITED, 'rate limited');
        return true;
      }
      m.perTick.set(seat, { tick, n: n + 1 });
      m.total.set(seat, total + 1);
      return true;
    }
    const r = m.lockstep.onHash(seat, msg.tick, msg.h);
    if (r.result === 'rate-limited') {
      conn.sendError('rate-limited');
      if (r.advice === 'disconnect') conn.close(CLOSE_RATE_LIMITED, 'rate limited');
      return true;
    }
    if (r.result === 'desync') {
      const t = now();
      const last = m.lastDesync.get(seat);
      if (last === undefined || t - last >= DESYNC_MIN_GAP_MS) {
        m.lastDesync.set(seat, t);
        conn.send(r.msg);
        log?.warn('desync', { room: room.code, matchId: room.match?.matchId, seat, tick: msg.tick, clientHash: msg.h, serverHash: r.msg.serverHash });
      }
    }
    return true;
  };

  const catchUp = (room: Room, conn: Conn): void => {
    const ls = servers.get(room);
    if (ls === undefined) return;
    const next = ls.nextTick;
    const chunks = ls.log.range(0, next);
    if (chunks.length === 0) conn.send({ t: 'catchup', from: 0, to: 0, cmds: [], done: true });
    chunks.forEach((ch, i) => conn.send({ t: 'catchup', from: ch.from, to: ch.to, cmds: [...ch.cmds], done: i === chunks.length - 1 }));
  };

  const onSeatDisconnect = (room: Room, seat: number): void => {
    const m = active.get(room);
    if (m === undefined || room.state !== 'running') return;
    const r = m.pause.disconnect(seat);
    if (!r.ok) return;
    log?.info('pause.disconnect', { room: room.code, seat });
    publish(room, m);
  };

  const onSeatReconnect = (room: Room, seat: number, conn: Conn): void => {
    const m = active.get(room);
    if (m === undefined || room.state !== 'running') return;
    const before = m.pause.epoch();
    m.pause.reconnect(seat);
    if (m.pause.epoch() !== before) publish(room, m, conn); // the reconnecting conn gets its snapshot from room.attachMidMatch, after start + catchup
  };

  const pauseState = (room: Room): PauseStateMsg | undefined => {
    const m = active.get(room);
    return m === undefined ? undefined : m.pause.snapshot(m.lockstep.nextTick);
  };

  const hasPendingDeadline = (room: Room): boolean => active.get(room)?.pause.paused() ?? false;

  const cancel = (room: Room): void => {
    const m = active.get(room);
    if (m !== undefined) { clock.remove(m.clockRoom); m.clockOn = false; m.pause.dispose(); }
    active.delete(room); ends.delete(room); servers.delete(room); sims.delete(room); feeds.delete(room);
  };

  return { onStart, cancel, onMessage, catchUp, onSeatDisconnect, onSeatReconnect, endOf: (room) => ends.get(room), pauseState, hasPendingDeadline, inspect: (room) => servers.get(room), simOf: (room) => sims.get(room) };
}
