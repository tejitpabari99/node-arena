/**
 * Pure pause/budget engine (SP07 Task 5). No I/O: time and timers are injected; the room layer
 * (Task 6/7) owns sockets, the clock and the log. All ms values are integers.
 */
import type { PauseHold, PauseReason, PauseStateMsg } from '@node-arena/net';

export const PAUSE_BUDGET_MS = 30_000;
export const IDLE_CLOSE_MS = 10 * 60_000;

export interface PauseSeat {
  player: number;
  kind: 'human' | 'bot';
  team: number;
}

export interface Hold {
  origin: PauseReason;
  connected: boolean;
  /** Epoch value right after the hold opened (wire `since`). */
  since: number;
  startedAt: number;
  /** null = unlimited mode (no expiry, no charge). */
  deadline: number | null;
}

export interface ExpiryEvent {
  /** Seats whose recorded deadline is the earliest one (forfeit together). */
  expired: number[];
  /** Every seat newly pending-forfeited (ascending); a superset of `expired` in the draw case. */
  forfeits: number[];
  /** All surviving humans were away: draw among every surviving seat. */
  draw: boolean;
  /** effectiveEliminated leaves <= 1 team: module has flushed (timers/holds cleared, ended). */
  terminal: boolean;
}

export interface PauseDeps {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  seats: PauseSeat[];
  budgetMs?: number;
  idleMs?: number;
  onExpire: (e: ExpiryEvent) => void;
  /** Sole-human abandonment (D14): no connected surviving human for idleMs with no deadline pending. */
  onIdle?: () => void;
}

export type OpenResult = { ok: true; repeat: boolean } | { ok: false; reason: 'paused' | 'not-eligible' | 'ended' };
export type ResumeResult = 'resumed' | 'stale' | 'none';
export type QuitResult = { ok: true; terminal: boolean } | { ok: false; reason: 'not-eligible' | 'ended' };

export interface PauseModule {
  /** Manual pause. Rejected `paused` while any hold exists, except an idempotent repeat by the owner. */
  pause(seat: number): OpenResult;
  resume(seat: number, epoch: number): ResumeResult;
  /** Detected connection loss: opens a disconnect hold, or marks an existing hold disconnected. */
  disconnect(seat: number): OpenResult;
  reconnect(seat: number): void;
  /** Confirmed quit / leave: seat becomes pending-forfeit (hold dropped). */
  quit(seat: number): QuitResult;
  /** Sim eliminations observed after a step. */
  syncEliminated(seats: Iterable<number>): void;
  /** Pending forfeits (ascending) to append as system cmds; they leave the set via syncEliminated once stepped. */
  pendingForfeits(): number[];
  effectiveEliminated(): number[];
  holdCount(): number;
  paused(): boolean;
  isTerminal(): boolean;
  epoch(): number;
  /** Remaining ms for a seat now (null = bot / unlimited / unknown). */
  budget(seat: number): number | null;
  holds(): Map<number, Hold>;
  snapshot(frozenTick: number): PauseStateMsg;
  /** Terminal flush: cancel timers, clear holds, bump epoch, ignore all later input. */
  flush(): void;
  dispose(): void;
}

export function createPause(deps: PauseDeps): PauseModule {
  const now = (): number => Math.trunc(deps.now());
  const total = deps.budgetMs ?? PAUSE_BUDGET_MS;
  const idleMs = deps.idleMs ?? IDLE_CLOSE_MS;
  const seats = [...deps.seats].sort((a, b) => a.player - b.player);
  const byPlayer = new Map(seats.map((s) => [s.player, s]));
  const balance = new Map<number, number>();
  const connected = new Map<number, boolean>();
  for (const s of seats) if (s.kind === 'human') { balance.set(s.player, total); connected.set(s.player, true); }
  const holds = new Map<number, Hold>();
  const simElim = new Set<number>();
  const pending = new Set<number>();
  let epoch = 0;
  let ended = false;
  let timer: unknown;
  let timerAt: number | null = null;
  let idleTimer: unknown;

  const eff = (p: number): boolean => simElim.has(p) || pending.has(p);
  const survivingHumans = (): number[] => seats.filter((s) => s.kind === 'human' && !eff(s.player)).map((s) => s.player);
  const unlimitedFor = (p: number): boolean => !survivingHumans().some((q) => q !== p);
  const aliveTeams = (): number => new Set(seats.filter((s) => !eff(s.player)).map((s) => s.team)).size;
  const terminalNow = (): boolean => aliveTeams() <= 1;

  const clearTimers = (): void => {
    if (timerAt !== null) deps.clearTimeout(timer);
    timerAt = null;
    if (idleTimer !== undefined) deps.clearTimeout(idleTimer);
    idleTimer = undefined;
  };

  const remaining = (p: number): number => {
    const h = holds.get(p);
    const bal = balance.get(p) ?? 0;
    if (!h || h.deadline === null) return bal;
    return Math.max(0, bal - (now() - h.startedAt));
  };

  /** Re-arm the single deadline timer and the idle timer from current state. */
  const rearm = (): void => {
    if (timerAt !== null) deps.clearTimeout(timer);
    timerAt = null;
    if (ended) return;
    let d0: number | null = null;
    for (const h of holds.values()) if (h.deadline !== null && (d0 === null || h.deadline < d0)) d0 = h.deadline;
    if (d0 !== null) {
      timerAt = d0;
      timer = deps.setTimeout(fire, Math.max(0, d0 - now()));
    }
    const sh = survivingHumans();
    const idle = deps.onIdle !== undefined && sh.length > 0 && d0 === null && sh.every((p) => !connected.get(p));
    if (idle && idleTimer === undefined) {
      idleTimer = deps.setTimeout(() => {
        idleTimer = undefined;
        if (ended) return;
        ended = true;
        clearTimers();
        deps.onIdle?.();
      }, idleMs);
    } else if (!idle && idleTimer !== undefined) {
      deps.clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  };

  /** Drop deadlines of holds whose seat became the only live human. */
  const recomputeUnlimited = (): boolean => {
    let changed = false;
    for (const [p, h] of holds) {
      if (h.deadline !== null && unlimitedFor(p)) {
        // charge what elapsed so far once, then stop charging
        balance.set(p, remaining(p));
        h.deadline = null;
        changed = true;
      }
    }
    return changed;
  };

  const flush = (): void => {
    if (ended) return;
    ended = true;
    clearTimers();
    holds.clear();
    epoch++;
  };

  function fire(): void {
    timerAt = null;
    if (ended) return;
    let d0: number | null = null;
    for (const h of holds.values()) if (h.deadline !== null && (d0 === null || h.deadline < d0)) d0 = h.deadline;
    if (d0 === null || d0 > now()) { rearm(); return; }
    const e0 = [...holds].filter(([, h]) => h.deadline === d0).map(([p]) => p).sort((a, b) => a - b);
    const sh = survivingHumans();
    const draw = sh.length > 0 && sh.every((p) => !connected.get(p));
    const forfeits = draw ? seats.filter((s) => !eff(s.player)).map((s) => s.player) : e0;
    for (const p of forfeits) { pending.add(p); holds.delete(p); }
    recomputeUnlimited();
    epoch++;
    const terminal = terminalNow();
    if (terminal) flush(); else rearm();
    deps.onExpire({ expired: e0, forfeits: [...forfeits], draw, terminal });
  }

  const budgetOf = (seat: number): number | null => {
    if (!balance.has(seat) || eff(seat)) return null;
    const sh = survivingHumans();
    return sh.length <= 1 && sh.includes(seat) ? null : remaining(seat);
  };

  const open = (seat: number, origin: PauseReason): OpenResult => {
    if (ended) return { ok: false, reason: 'ended' };
    const s = byPlayer.get(seat);
    if (!s || s.kind !== 'human' || eff(seat)) return { ok: false, reason: 'not-eligible' };
    const existing = holds.get(seat);
    if (origin === 'manual') {
      if (existing) return existing.origin === 'manual' ? { ok: true, repeat: true } : { ok: false, reason: 'paused' };
      if (holds.size > 0) return { ok: false, reason: 'paused' };
    } else if (existing) {
      if (existing.connected) { existing.connected = false; epoch++; }
      connected.set(seat, false);
      rearm();
      return { ok: true, repeat: true };
    }
    const t = now();
    epoch++;
    holds.set(seat, {
      origin, connected: connected.get(seat) ?? true, since: epoch, startedAt: t,
      deadline: unlimitedFor(seat) ? null : t + (balance.get(seat) ?? 0),
    });
    recomputeUnlimited();
    rearm();
    return { ok: true, repeat: false };
  };

  return {
    pause: (seat) => open(seat, 'manual'),
    disconnect(seat) {
      connected.set(seat, false);
      return open(seat, 'disconnect');
    },
    reconnect(seat) {
      if (ended || !connected.has(seat)) return;
      connected.set(seat, true);
      const h = holds.get(seat);
      if (h && !h.connected) { h.connected = true; epoch++; }
      rearm();
    },
    resume(seat, ep) {
      if (ended) return 'none';
      const h = holds.get(seat);
      if (!h) return 'none';
      if (ep < h.since) return 'stale';
      if (h.deadline !== null) balance.set(seat, remaining(seat));
      holds.delete(seat);
      epoch++;
      rearm();
      return 'resumed';
    },
    quit(seat) {
      if (ended) return { ok: false, reason: 'ended' };
      const s = byPlayer.get(seat);
      if (!s || s.kind !== 'human' || eff(seat)) return { ok: false, reason: 'not-eligible' };
      pending.add(seat);
      holds.delete(seat);
      epoch++;
      const terminal = terminalNow();
      if (terminal) flush();
      else { recomputeUnlimited(); rearm(); }
      return { ok: true, terminal };
    },
    syncEliminated(list) {
      if (ended) return;
      let added = false;
      for (const p of list) if (!simElim.has(p)) { simElim.add(p); pending.delete(p); holds.delete(p); added = true; }
      if (!added) return;
      recomputeUnlimited();
      epoch++;
      rearm();
    },
    pendingForfeits() {
      return [...pending].filter((p) => !simElim.has(p)).sort((a, b) => a - b);
    },
    effectiveEliminated: () => seats.map((s) => s.player).filter(eff),
    holdCount: () => holds.size,
    paused: () => holds.size > 0,
    isTerminal: () => ended || terminalNow(),
    epoch: () => epoch,
    budget: budgetOf,
    holds: () => holds,
    snapshot(frozenTick) {
      const max = seats.reduce((m, s) => Math.max(m, s.player), -1) + 1;
      const budgets: (number | null)[] = [];
      for (let i = 0; i < max; i++) budgets.push(budgetOf(i));
      const hl: PauseHold[] = [...holds]
        .sort((a, b) => a[0] - b[0])
        .map(([player, h]) => ({ player, reason: h.origin, connected: h.connected, since: h.since }));
      return {
        t: 'pause.state', epoch, paused: hl.length > 0, tick: frozenTick,
        unlimited: survivingHumans().length <= 1, holds: hl, budgets,
      };
    },
    flush,
    dispose() { ended = true; clearTimers(); },
  };
}
