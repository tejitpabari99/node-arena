import { ownership } from '../ui/ownership';
import type { CompiledLevel } from '@node-arena/content';
import { create, TICK_RATE, type Command, type Sim, type SimEvent } from '@node-arena/sim';
import { createBotDriver, type BotDriver, type CreateBotDriver } from './bot';

export { createBotDriver, type BotDriver, type CreateBotDriver } from './bot';
export const STEP_MS = 1000 / TICK_RATE;
export const MAX_FRAME_MS = 250;
export const MAX_FRAME_STEPS = 5;
export type PauseReason = 'manual' | 'hidden' | null;
export interface CommandSubmission { readonly tick: number; readonly cmd: Readonly<Command> }
export interface TickUpdate {
  /** Completed tick; submissions use the previous (zero-based) sim tick. */
  readonly tick: number;
  readonly sim: Sim;
  readonly submissions: readonly CommandSubmission[];
  readonly events: readonly SimEvent[];
}
export interface FrameUpdate {
  readonly sim: Sim;
  readonly alpha: number;
  readonly steps: number;
  readonly paused: boolean;
  /** CPU spent preparing this frame, including fixed steps and tick subscribers. */
  readonly preparationMs?: number;
}
export interface DriverEnvironment {
  requestFrame(callback: (timestamp: number) => void): number;
  cancelFrame(id: number): void;
  isHidden(): boolean;
  onVisibilityChange(callback: () => void): () => void;
}
export interface GameDriverOptions {
  level: CompiledLevel;
  matchSeed: number;
  /** Defaults to true; false allows deterministic tests without a live rAF loop. */
  autoStart?: boolean;
  environment?: DriverEnvironment;
  createSim?: (level: CompiledLevel, matchSeed: number) => Sim;
  createBotDriver?: CreateBotDriver;
  onFrame?: (update: FrameUpdate) => void;
  onTick?: (update: TickUpdate) => void;
  onPauseChange?: (reason: PauseReason) => void;
}

/** Undefined outside a browser: the public manual/frame API remains usable in Node. */
function browserEnvironment(): DriverEnvironment | undefined {
  if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
  return {
    requestFrame: callback => window.requestAnimationFrame(callback),
    cancelFrame: id => window.cancelAnimationFrame(id),
    isHidden: () => document.hidden,
    onVisibilityChange(callback) {
      document.addEventListener('visibilitychange', callback);
      return () => document.removeEventListener('visibilitychange', callback);
    },
  };
}

/** Owns level lifetime and all steps. Consumers read sim/view and submit commands. */
export class GameDriver {
  private currentSim: Sim;
  private stepMs = 0;
  get lastStepMs(): number { return this.stepMs; }
  private level: CompiledLevel;
  private matchSeed: number;
  private bot: BotDriver;
  private readonly environment: DriverEnvironment | undefined;
  private readonly removeVisibilityListener: (() => void) | undefined;
  private readonly simFactory: (level: CompiledLevel, seed: number) => Sim;
  private readonly botFactory: CreateBotDriver;
  private queued: CommandSubmission[] = [];
  private accumulator = 0;
  private previousTimestamp: number | null = null;
  private multiplier: 1 | 2 = 1;
  private reason: PauseReason = null;
  private running = false;
  private disposed = false;
  private frameId: number | null = null;

  constructor(private readonly options: GameDriverOptions) {
    this.level = options.level;
    this.matchSeed = options.matchSeed;
    this.simFactory = options.createSim ?? create;
    this.botFactory = options.createBotDriver ?? createBotDriver;
    this.currentSim = this.simFactory(this.level, this.matchSeed);
    this.bot = this.botFactory(this.level, this.matchSeed);
    this.environment = options.environment ?? browserEnvironment();
    this.removeVisibilityListener = this.environment?.onVisibilityChange(() => {
      if (this.environment?.isHidden()) this.setPause('hidden');
      // Becoming visible never resumes automatically or preserves a time baseline.
      this.resetTiming();
    });
    if (this.environment?.isHidden()) this.setPause('hidden');
    if (options.autoStart !== false) this.start();
  }

  /** Computed only when read by the HUD/probe, never in the animation loop. */
  get ownership() { return ownership(this.currentSim.view); }
  get sim(): Sim { return this.currentSim; }
  get alpha(): number { return this.accumulator / STEP_MS; }
  get paused(): boolean { return this.reason !== null; }
  get pauseReason(): PauseReason { return this.reason; }
  get speed(): 1 | 2 { return this.multiplier; }

  setSpeed(speed: 1 | 2): void {
    if (speed !== 1 && speed !== 2) throw new RangeError('Speed must be 1 or 2');
    this.multiplier = speed;
  }

  /** Stamp at submission; copy/freeze so caller edits cannot change queued input. */
  submit(cmd: Command): CommandSubmission | null {
    if (!this.canStep()) return null;
    const submission = Object.freeze({ tick: this.sim.view.tick, cmd: Object.freeze({ ...cmd }) });
    this.queued.push(submission);
    return submission;
  }

  pause(): void { if (!this.disposed) this.setPause('manual'); }
  resume(): void {
    if (this.disposed || !this.paused || this.environment?.isHidden()) return;
    this.setPause(null);
  }

  restart(level = this.level, matchSeed = this.matchSeed): void {
    if (this.disposed) return;
    const sim = this.simFactory(level, matchSeed);
    const bot = this.botFactory(level, matchSeed);
    this.level = level; this.matchSeed = matchSeed;
    this.currentSim = sim; this.bot = bot;
    this.queued = [];
    this.resetTiming();
    this.setPause(this.environment?.isHidden() ? 'hidden' : null);
  }

  start(): void {
    if (this.disposed || this.running || !this.environment) return;
    this.running = true;
    this.resetTiming();
    this.scheduleFrame();
  }

  stop(): void {
    this.running = false;
    if (this.frameId !== null) this.environment?.cancelFrame(this.frameId);
    this.frameId = null;
    this.resetTiming();
    this.queued = [];
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.removeVisibilityListener?.();
    this.disposed = true;
  }

  /** Feed rAF timestamps directly, or inject requestFrame for full lifecycle tests. */
  advanceFrame(timestamp: number): void {
    if (this.disposed) return;
    if (!Number.isFinite(timestamp)) throw new RangeError('Frame timestamp must be finite');
    const frameStart = performance.now();
    let steps = 0;
    if (!this.canStep()) this.resetTiming();
    else {
      const elapsed = this.previousTimestamp === null ? 0 : Math.max(0, timestamp - this.previousTimestamp);
      this.previousTimestamp = timestamp;
      this.accumulator += Math.min(elapsed, MAX_FRAME_MS) * this.multiplier;
      while (this.accumulator >= STEP_MS && steps < MAX_FRAME_STEPS && this.canStep()) {
        this.accumulator -= STEP_MS;
        this.fixedStep();
        steps++;
      }
      // Drop overdue whole ticks, preserving only the fractional render interval.
      if (this.accumulator >= STEP_MS) this.accumulator %= STEP_MS;
      if (!this.canStep()) this.resetTiming();
    }
    this.emitFrame(steps, performance.now() - frameStart);
  }

  /** Test mode: fixed ticks without wall time. Pause/visibility/gameover still apply. */
  step(count = 1): number {
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Tick count must be a nonnegative safe integer');
    if (this.disposed) return 0;
    const frameStart = performance.now();
    this.resetTiming();
    let steps = 0;
    while (steps < count && this.canStep()) { this.fixedStep(); steps++; }
    this.emitFrame(steps, performance.now() - frameStart);
    return steps;
  }

  private canStep(): boolean {
    return !this.disposed && !this.paused && !this.environment?.isHidden() && !this.sim.view.over;
  }

  private fixedStep(): void {
    const players = this.queued;
    this.queued = [];
    const bots = this.bot.commands(this.sim).map(cmd => Object.freeze({ tick: this.sim.view.tick, cmd: Object.freeze({ ...cmd }) }));
    const submissions = Object.freeze([...players, ...bots]);
    const commands = submissions.map(submission => submission.cmd);
    const start = performance.now();
    const events = this.sim.step(commands, { events: true });
    this.stepMs = performance.now() - start;
    if (this.sim.view.over) this.queued = [];
    this.options.onTick?.({ tick: this.sim.view.tick, sim: this.sim, submissions, events });
  }

  private emitFrame(steps: number, preparationMs = 0): void {
    if (!this.disposed) this.options.onFrame?.({ sim: this.sim, alpha: this.alpha, steps, paused: this.paused, preparationMs });
  }

  private setPause(reason: PauseReason): void {
    this.queued = [];
    this.resetTiming();
    if (this.reason === reason) return;
    this.reason = reason;
    this.options.onPauseChange?.(reason);
  }

  private resetTiming(): void { this.accumulator = 0; this.previousTimestamp = null; }

  private scheduleFrame(): void {
    if (!this.running || this.disposed || !this.environment) return;
    this.frameId = this.environment.requestFrame(timestamp => {
      this.frameId = null;
      this.advanceFrame(timestamp);
      this.scheduleFrame();
    });
  }
}
