import { create, type Sim } from '@node-arena/sim';
import { encodeTick, endMessage, HASH_INTERVAL, LockstepServer, type ClientMessage, type SeatKind } from '@node-arena/net';
import type { Clock, ClockRoom } from './clock.js';
import type { Conn } from './conn.js';
import type { Logger } from './log.js';
import type { MatchStart, Room } from './room.js';

export const DESYNC_MIN_GAP_MS = 10_000;
/** Max accepted `cmd`s per seat per target tick; excess gets `rate-limited` (full token bucket is M2). */
export const MAX_CMDS_PER_SEAT_PER_TICK = 8;

export interface MatchDeps {
  clock: Pick<Clock, 'add' | 'remove'>;
  now: () => number;
  log?: Logger;
  /** Test seam: bot commands for this tick (empty in M1). */
  botCommands?: (match: MatchStart) => readonly import('@node-arena/defs').Command[];
}

export interface MatchController {
  onStart(room: Room, match: MatchStart): void;
  /** Routes `cmd` / `hash` from a seated player. Returns false if the message is not match-related. */
  onMessage(room: Room, conn: Conn, seat: number, msg: ClientMessage): boolean;
  /** Test-visible: the room's lockstep server (command log survives match end). */
  inspect(room: Room): LockstepServer | undefined;
  /** Test-visible: the room's referee sim. */
  simOf(room: Room): Sim | undefined;
}

/** Authoritative loop per room: referee sim + lockstep, driven by the shared clock. Never waits on clients. */
export function createMatchController(deps: MatchDeps): MatchController {
  const { clock, now, log } = deps;
  const servers = new WeakMap<Room, LockstepServer>();
  const sims = new WeakMap<Room, Sim>();
  // Kept after match end so late hashes are still compared against stored checkpoints.
  const active = new WeakMap<Room, { lockstep: LockstepServer; lastDesync: Map<number, number>; perTick: Map<number, { tick: number; n: number }>; total: Map<number, number>; seatBudget: number }>();

  const frameTo = (room: Room, frame: string): void => {
    for (const c of room.conns()) {
      try { c.sendFrame(frame); } catch { /* dead socket; disconnect FSM handles it later */ }
    }
  };

  const onStart = (room: Room, match: MatchStart): void => {
    const sim = create(match.level, match.seed, { teams: match.teams });
    sims.set(room, sim);
    const kinds: SeatKind[] = room.seats.map((s) => s.kind);
    const lockstep = new LockstepServer({
      seats: kinds, inputDelay: match.inputDelay, buildingCount: sim.view.ids.buildings.length, log: { timeLimitTicks: match.timeLimitTicks },
    });
    servers.set(room, lockstep);
    const seatBudget = Math.max(1, Math.floor(lockstep.log.cmdCap / Math.max(1, kinds.length)));
    active.set(room, { lockstep, lastDesync: new Map(), perTick: new Map(), total: new Map(), seatBudget });

    const stop = (): void => { clock.remove(clockRoom); };
    const abort = (err: unknown): void => {
      stop();
      room.state = 'closed';
      room.endedAt = now();
      log?.error('match.internal', { room: room.code, matchId: match.matchId, error: err instanceof Error ? err.message : String(err) });
      for (const c of room.conns()) {
        c.sendError('internal');
        c.send({ t: 'room.closed', reason: 'internal' });
      }
    };

    const tick = (): void => {
      if (room.state === 'ended' || room.state === 'closed') { stop(); return; }
      try {
        if (room.state === 'countdown') room.state = 'running';
        const botCmds = deps.botCommands?.(match) ?? [];
        const { n, cmds, dropped, firstDrop } = lockstep.closeTick(botCmds);
        if (dropped > 0) throw new Error(`command log refused ${dropped} cmds: ${firstDrop}`);
        sim.step(cmds, { events: false });
        if (sim.view.tick % HASH_INTERVAL === 0) lockstep.recordCheckpoint(sim.view.tick, sim.hash());
        frameTo(room, encodeTick(n, cmds));
        if (sim.view.over !== null) {
          const finalTick = sim.view.tick;
          const end = endMessage(sim.view.over, finalTick, sim.hash());
          if (end === null) throw new Error('non-pvp outcome');
          room.state = 'ended';
          room.endedAt = now();
          stop();
          for (const c of room.conns()) c.send(end);
          log?.info('match.end', { room: room.code, matchId: match.matchId, finalTick, outcome: end.outcome.outcome });
        }
      } catch (err) {
        abort(err);
      }
    };
    const clockRoom: ClockRoom = { startAt: match.startAt, tick };
    clock.add(clockRoom);
  };

  const onMessage = (room: Room, conn: Conn, seat: number, msg: ClientMessage): boolean => {
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
      const tick = m.lockstep.nextTick + m.lockstep.inputDelay;
      const pt = m.perTick.get(seat);
      const n = pt !== undefined && pt.tick === tick ? pt.n : 0;
      const total = m.total.get(seat) ?? 0;
      if (n >= MAX_CMDS_PER_SEAT_PER_TICK || total >= m.seatBudget) {
        conn.sendError('rate-limited');
        return true;
      }
      const r = m.lockstep.submit(seat, msg.c);
      if (!r.accepted) { conn.sendError(r.rejected); return true; }
      m.perTick.set(seat, { tick, n: n + 1 });
      m.total.set(seat, total + 1);
      return true;
    }
    const r = m.lockstep.onHash(seat, msg.tick, msg.h);
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

  return { onStart, onMessage, inspect: (room) => servers.get(room), simOf: (room) => sims.get(room) };
}
