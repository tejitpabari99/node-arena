import type { Command } from '@node-arena/defs';
import { create, type Sim, type SeatSetup } from '@node-arena/sim';
import { LockstepClient } from './lockstep-client.js';
import type { CatchupMsg, HashMsg, ServerMessage, StartMsg, TicksMsg, TickCmds } from './messages.js';

/** Chunk shape accepted by `feed`: a `catchup` or `ticks` message (or a bare `CommandLog.range` chunk). */
export type CatchupChunk = { from: number; to: number; cmds: readonly TickCmds[]; done?: boolean };
export type CatchupProgress = { tick: number; target: number };
export type CatchupErrorCode = 'version-mismatch' | 'gap' | 'bad-range';

export class CatchupError extends Error {
  constructor(readonly code: CatchupErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'CatchupError';
  }
}

/** Catch-up runner (PRD 02 R7; also the SP07 M2 reconnect path). Owns a fresh Sim replayed from tick 0. */
export interface Catchup {
  readonly sim: Sim;
  /** Queue the next contiguous chunk (must start at the previous chunk's `to`; first starts at 0). Throws CatchupError. */
  feed(chunk: CatchupChunk): void;
  /**
   * Step queued ticks (`{events:false}`) until `budgetMs` of injected-clock time is spent or the queue is empty.
   * Always steps at least one tick when any is queued. Never steps past the fed target, so a caller catching up to a
   * frozen/paused tick consumes no future ticks. Returns ticks stepped.
   */
  run(budgetMs: number, now: () => number): number;
  /** `tick` = sim.view.tick, `target` = `to` of the last fed chunk. */
  readonly progress: CatchupProgress;
  /** True once a `done` chunk was fed and every fed tick is stepped (the sim may since have advanced via live ticks). */
  readonly done: boolean;
}

export function createCatchup(level: Parameters<typeof create>[0], seed: number, setup?: SeatSetup): Catchup {
  const sim = create(level, seed, setup);
  const queue: Command[][] = [];
  let head = 0;
  let fedTo = 0;
  let doneFed = false;

  return {
    sim,
    feed(chunk) {
      const { from, to } = chunk;
      if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) throw new CatchupError('bad-range', `[${from},${to})`);
      if (doneFed) throw new CatchupError('gap', 'chunk after done');
      if (from !== fedTo) throw new CatchupError('gap', `expected ${fedTo}, got ${from}`);
      const per: Command[][] = [];
      for (let i = from; i < to; i++) per.push([]);
      for (const e of chunk.cmds) {
        if (!Number.isInteger(e.tick) || e.tick < from || e.tick >= to) throw new CatchupError('bad-range', `cmd tick ${e.tick} outside [${from},${to})`);
        per[e.tick - from]!.push(e.cmd);
      }
      for (const p of per) queue.push(p);
      fedTo = to;
      if (chunk.done === true) doneFed = true;
    },
    run(budgetMs, now) {
      const start = now();
      let n = 0;
      while (head < queue.length) {
        sim.step(queue[head]!, { events: false });
        head++; n++;
        if (now() - start >= budgetMs) break;
      }
      if (head === queue.length) { queue.length = 0; head = 0; }
      return n;
    },
    get progress() { return { tick: sim.view.tick, target: fedTo }; },
    get done() { return doneFed && head === queue.length; },
  };
}

/**
 * Build a catch-up from the `start` message. `resolveLevel` is caller-supplied (net has no content). Wire
 * `start.simHash` is the 16-hex prefix of `level.simHash`; mismatch throws `version-mismatch`.
 */
export function createCatchupFromStart(
  start: StartMsg,
  resolveLevel: (levelId: string) => (Parameters<typeof create>[0]) | undefined,
  setup?: SeatSetup,
): Catchup {
  const level = resolveLevel(start.levelId);
  if (level === undefined) throw new CatchupError('version-mismatch', `unknown level ${start.levelId}`);
  const simHash = (level as { simHash: string }).simHash;
  if (typeof simHash !== 'string' || simHash.slice(0, start.simHash.length) !== start.simHash) {
    throw new CatchupError('version-mismatch', `simHash ${String(simHash).slice(0, 16)} != ${start.simHash}`);
  }
  return createCatchup(level, start.seed, setup);
}

export interface JoinLate {
  readonly catchup: Catchup;
  /** Route a server message: `catchup`/`ticks` before the done chunk feed the runner; `tick`s are held until hand-off. */
  push(msg: ServerMessage): void;
  /** Step with a shared budget: catch-up first, then live ticks; returns due `hash` messages (live ticks only). */
  run(budgetMs: number, now: () => number): HashMsg[];
  /** True when caught up and driving live ticks. */
  readonly live: boolean;
  /** Live queue; defined after the done chunk was fed. */
  readonly client: LockstepClient | null;
}

/**
 * Local join-late helper (M1-usable by tests; M2 reconnect). Ordered transport guarantees live `tick`s follow
 * the done `catchup` chunk, so the live client starts at the done chunk's `to` with no gap.
 */
export function createJoinLate(catchup: Catchup): JoinLate {
  let client: LockstepClient | null = null;
  const held: ServerMessage[] = [];
  return {
    catchup,
    get client() { return client; },
    get live() { return client !== null && catchup.done; },
    push(msg) {
      if (msg.t === 'catchup' || msg.t === 'ticks') {
        if (client === null) {
          catchup.feed(msg as CatchupMsg | TicksMsg);
          if (msg.t === 'catchup' && msg.done) {
            client = new LockstepClient(msg.to);
            for (const m of held) client.push(m);
            held.length = 0;
          }
        } else client.push(msg);
        return;
      }
      if (msg.t === 'tick') {
        if (client === null) held.push(msg); else client.push(msg);
      }
    },
    run(budgetMs, now) {
      const start = now();
      const hashes: HashMsg[] = [];
      catchup.run(budgetMs, now);
      if (!catchup.done || client === null) return hashes;
      const sim = catchup.sim;
      while (now() - start < budgetMs) {
        const t = client.drain(1)[0];
        if (t === undefined) break;
        sim.step(t.cmds, { events: false });
        const h = client.after(t.n, () => sim.hash());
        if (h !== null) hashes.push(h);
      }
      return hashes;
    },
  };
}
