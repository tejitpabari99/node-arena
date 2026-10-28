/** Single drift-corrected 20 Hz loop for all rooms (PRD Decision 1). */

export const TICK_MS = 50;
export const MAX_CATCHUP = 4;
export const REBASE_MS = 500;
const LATENESS_SAMPLES = 400;

export interface ClockRoom {
  /** Epoch ms (clock `now` domain) from which tick() is called each loop tick. */
  startAt: number;
  tick(): void;
}

export interface ClockDeps {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: never) => void;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

export interface Clock {
  add(room: ClockRoom): void;
  remove(room: ClockRoom): void;
  start(): void;
  stop(): void;
  /** Round t up to the next loop boundary. */
  boundary(t: number): number;
  lateness(): { p50: number; p99: number };
}

export function createClock(deps: ClockDeps): Clock {
  const { now, log } = deps;
  const rooms = new Set<ClockRoom>();
  const samples: number[] = [];
  let nextDue = now();
  let handle: unknown;
  let running = false;

  const schedule = (): void => {
    const delay = Math.max(0, nextDue - now());
    handle = deps.setTimeout(wake, delay);
  };

  const wake = (): void => {
    if (!running) return;
    const t = now();
    const late = Math.max(0, t - nextDue);
    samples.push(late);
    if (samples.length > LATENESS_SAMPLES) samples.shift();
    if (late > REBASE_MS) {
      log?.('clock.rebase', { behindMs: late });
      nextDue = t;
    }
    for (let i = 0; i < MAX_CATCHUP && nextDue <= t; i++) {
      for (const room of [...rooms]) {
        if (!rooms.has(room) || room.startAt > nextDue) continue;
        try {
          room.tick();
        } catch (err) {
          log?.('clock.room_error', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      nextDue += TICK_MS;
    }
    if (running) schedule();
  };

  const pct = (p: number): number => {
    if (samples.length === 0) return 0;
    const s = [...samples].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] ?? 0;
  };

  return {
    add: (room) => void rooms.add(room),
    remove: (room) => void rooms.delete(room),
    start() {
      if (running) return;
      running = true;
      nextDue = now();
      schedule();
    },
    stop() {
      running = false;
      if (handle !== undefined) deps.clearTimeout?.(handle as never);
      handle = undefined;
    },
    boundary: (t) => nextDue + Math.ceil((t - nextDue) / TICK_MS) * TICK_MS,
    lateness: () => ({ p50: pct(0.5), p99: pct(0.99) }),
  };
}
