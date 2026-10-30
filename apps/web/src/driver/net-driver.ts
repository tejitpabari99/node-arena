import type { ClientMessage, HashMsg, LockstepClient, PushResult, ServerMessage, WireCommand } from '@node-arena/net';
import type { Command, Sim, SimEvent } from '@node-arena/sim';
import { ownership } from '../ui/ownership';
import { STEP_MS, type FrameUpdate, type MatchDriver, type TickUpdate } from './index';

export const LIVE_MAX_STEPS = 2;
export const CATCHUP_THRESHOLD = 6;
export const CATCHUP_BUDGET_MS = 8;
export const CATCHUP_EVENT_TAIL = 2;
/** Overlay shows once queued exceeds this (or while `catchup` chunks are still arriving) and hides when drained to CATCHUP_THRESHOLD. */
export const CATCHUP_SHOW_QUEUED = 40;

export interface NetDriverOptions {
  sim: Sim;
  client: LockstepClient;
  send: (msg: ClientMessage) => void;
  /** Monotonic ms clock (performance.now); only used for alpha and budgets, never fed to the sim. */
  now: () => number;
  raf?: (cb: (t: number) => void) => number;
  caf?: (id: number) => void;
  onTick?: (update: TickUpdate) => void;
  /** Every rAF after stepping (also with 0 steps), for rendering. */
  onFrame?: (update: FrameUpdate) => void;
  /** Called when the client rejects a pushed message (gap/duplicate/bad-range): controller should resync. */
  /** Spectator: never sends hash or cmd (server rejects both with not-your-seat). */
  spectator?: boolean;
  onPushError?: (result: Extract<PushResult, { ok: false }>, msg: ServerMessage) => void;
}

/** Server-paced MatchDriver: steps only on ticks pushed from the socket; no pause, speed or hidden handling. */
export class NetDriver implements MatchDriver {
  readonly paused = false;
  private stepMs = 0;
  private lastStepAt: number | null = null;
  private frameId: number | null = null;
  private running = false;
  private disposed = false;
  private awaitingDone = false;
  private latched = false;
  private frozen: number | null = null;
  /** Exclusive end of the server's catch-up replay; ticks below it are never hashed (a burst would trip the server's hash limit). */
  private catchupTarget = 0;
  private deferHash = false;
  private pendingHash: HashMsg | null = null;
  private readonly raf: (cb: (t: number) => void) => number;
  private readonly caf: (id: number) => void;

  constructor(private readonly o: NetDriverOptions) {
    this.raf = o.raf ?? (cb => globalThis.requestAnimationFrame(cb));
    this.caf = o.caf ?? (id => globalThis.cancelAnimationFrame(id));
  }

  get sim(): Sim { return this.o.sim; }
  get lastStepMs(): number { return this.stepMs; }
  get ownership() { return ownership(this.o.sim.view); }
  get queued(): number { return this.o.client.queued(); }
  /** Ticks stepped so far (sim tick). */
  get tick(): number { return this.o.sim.view.tick; }
  /**
   * Catch-up progress in 0..1 (`tick / (tick + queued)`) while the overlay should show (join, reconnect,
   * background-return); null when live. Reusable for a repeated `start` of the same matchId: build a fresh
   * driver and push the new `catchup` stream.
   */
  get catchupProgress(): number | null {
    if (!this.latched) return null;
    const tick = this.o.sim.view.tick, total = tick + this.o.client.queued();
    return total === 0 ? 0 : tick / total;
  }
  /** Server-frozen tick (SP07 pause) or null; stepping holds at `sim.view.tick === frozenTick`. */
  get frozenTick(): number | null { return this.frozen; }
  /** Freeze at `tick` (pause.state paused) or release with null. Frames beyond the frozen tick (the terminal-forfeit tick the server closes before its final pause.state) stay queued, unstepped, until released. */
  setFrozen(tick: number | null): void { this.frozen = tick; }
  private canStep(): boolean { return this.frozen === null || this.o.sim.view.tick < this.frozen; }
  get alpha(): number {
    if (this.lastStepAt === null || this.o.client.queued() === 0) return 1;
    return Math.min(1, Math.max(0, (this.o.now() - this.lastStepAt) / STEP_MS));
  }

  /** Feed a server message from the socket handler (not rAF). tick/ticks/catchup are queued. */
  push(msg: ServerMessage): PushResult {
    if (this.disposed) return { ok: true };
    const r = this.o.client.push(msg);
    if (!r.ok) this.o.onPushError?.(r, msg);
    else if (msg.t === 'catchup') { this.awaitingDone = !msg.done; this.catchupTarget = Math.max(this.catchupTarget, msg.to); }
    this.updateCatchup();
    return r;
  }

  /** Sends `cmd` without `player`/tick; server stamps both. Returns the wire message. */
  submit(cmd: Command | WireCommand, cid?: number): unknown {
    if (this.disposed || this.o.spectator || this.frozen !== null) return null; // server rejects cmd while paused
    const { player: _player, ...c } = cmd as Command;
    void _player;
    const msg = this.o.client.cmd(c as WireCommand, cid);
    this.o.send(msg);
    return msg;
  }

  start(): void {
    if (this.disposed || this.running) return;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.frameId !== null) this.caf(this.frameId);
    this.frameId = null;
  }

  dispose(): void { this.stop(); this.disposed = true; }

  /** One frame's worth of stepping; exposed so tests and the rAF loop share it. Returns steps taken. */
  advance(): number {
    if (this.disposed || this.o.sim.view.over) return 0;
    const { client } = this.o;
    const queued = client.queued();
    if (queued === 0) return 0;
    let steps = 0;
    this.deferHash = queued > CATCHUP_THRESHOLD;
    this.pendingHash = null;
    if (queued > CATCHUP_THRESHOLD) {
      const t0 = this.o.now();
      while (client.queued() > 0 && !this.o.sim.view.over && this.canStep() && this.o.now() - t0 < CATCHUP_BUDGET_MS) {
        const [tk] = client.drain(1);
        if (!tk) break;
        this.stepOne(tk.n, tk.cmds, client.queued() < CATCHUP_EVENT_TAIL);
        steps++;
      }
    } else {
      while (steps < LIVE_MAX_STEPS && client.queued() > 0 && !this.o.sim.view.over && this.canStep()) {
        const [tk] = client.drain(1);
        if (!tk) break;
        this.stepOne(tk.n, tk.cmds, true);
        steps++;
      }
    }
    this.deferHash = false;
    // Draining a backlog: only the latest due hash per frame (server limit 4/s).
    if (this.pendingHash) { this.o.send(this.pendingHash); this.pendingHash = null; }
    this.updateCatchup();
    return steps;
  }

  private updateCatchup(): void {
    const q = this.o.client.queued();
    if (this.awaitingDone || q > CATCHUP_SHOW_QUEUED) this.latched = true;
    else if (q <= CATCHUP_THRESHOLD) this.latched = false;
  }

  private stepOne(n: number, cmds: Command[], events: boolean): void {
    const { sim } = this.o;
    const t0 = this.o.now();
    const ev: SimEvent[] = sim.step(cmds, { events });
    this.lastStepAt = this.o.now();
    this.stepMs = this.lastStepAt - t0;
    const hash: HashMsg | null = this.o.client.after(n, () => sim.hash());
    if (hash && !this.o.spectator && n >= this.catchupTarget) {
      if (this.deferHash) this.pendingHash = hash; else this.o.send(hash);
    }
    this.o.onTick?.({ tick: sim.view.tick, sim, submissions: [], events: ev });
  }

  private schedule(): void {
    if (!this.running || this.disposed) return;
    this.frameId = this.raf(() => {
      this.frameId = null;
      const steps = this.advance();
      this.o.onFrame?.({ sim: this.o.sim, alpha: this.alpha, steps, paused: false });
      this.schedule();
    });
  }
}
