import type { CompiledLevel as ContentCompiledLevel } from '@node-arena/content';
import type { TroopRing } from './ring.js';
import type { Stream } from './streams.js';
import type { ModuleId, Phase, RejectReason, SimEvent } from '@node-arena/defs';

export type CompiledLevel = ContentCompiledLevel;
export type LineCutReason = 'player' | 'replaced' | 'captured';
/** Per-match seat setup: `teams[i]` = team id of seat i (R-TEM-01). */
export interface SeatSetup { readonly teams: readonly number[] }
/** Derived final placement per team (R-WIN-07); never hashed. */
export interface Placement {
  team: number; seats: number[]; rank: number; buildings: number; troops: number; eliminatedAt: number | null;
}
export type Outcome = 'won' | 'lost' | 'timeout' | 'victory' | 'timeLimit' | 'draw';

/** Building columns (int32, one slot per building). `col` holds `<module>.<field>` columns. */
export interface Buildings {
  readonly n: number;
  readonly owner: Int32Array;
  readonly level: Int32Array;
  readonly maxLevel: Int32Array;
  readonly stage: Int32Array;
  readonly lines: Int32Array;
  readonly alive: Int32Array;
  readonly ignoreForWin: Int32Array;
  readonly col: Record<string, Int32Array>;
}

/** Seat columns (int32). `kind`: 0 human, 1 ai. colorKey is view-only and lives in the level. */
export interface Players {
  readonly n: number; readonly kind: Int32Array;
  /** Tick a seat was eliminated (R-ELM-01), -1 while alive. Written only for objective `pvp`. */
  readonly eliminatedAt: Int32Array;
}

/** Ordered pair `from -> to`, key `from*n+to`, created lazily. Owner is derived (`owner[from]`). */
export interface Channel {
  readonly key: number;
  readonly from: number;
  readonly to: number;
  /** 1 while the line exists. */
  drawn: number;
  drawSeq: number;
  /** Spawn timer in milli-ticks; reset on draw, zeroed with the line. */
  timer: number;
  /** Symmetric lane length in progress units (numericScale x tickRate per world unit); static, not hashed. */
  readonly length: number;
  readonly troops: TroopRing;
}

/** Conservation ledger: spawned = alive + arrived + died (clash) + killed (capture/tower). Diagnostic, not hashed. */
export interface Counters { spawned: number; arrived: number; died: number; killed: number }

export interface SimState {
  readonly level: CompiledLevel;
  readonly seed: number;
  /** Per building: index of the unit its `spawns` module produces, else -1 (resolved and validated at create). */
  readonly unitOf: Int32Array;
  /** Per module id: indexes of buildings carrying it (static; computed once at create). */
  readonly carriers: Readonly<Record<ModuleId, Int32Array>>;
  tick: number;
  over: { outcome: Outcome; winner: number | null; winners?: number[]; ranking?: Placement[] } | null;
  drawSeq: number;
  troopSeq: number;
  rejected: number;
  readonly buildings: Buildings;
  readonly players: Players;
  /** Static team id per seat (R-TEM-01); not hashed or mutated. */
  readonly team: Int32Array;
  /** Lazy channels by key; hashed in ascending key order, only while live (drawn or holding troops). */
  readonly channels: Map<number, Channel>;
  /** Eager per-building surplus-forward streams (`fwd`, idx = building). */
  readonly fwd: readonly Stream[];
  readonly counters: Counters;
  /** Present only while a step runs with `{ events: true }`; events never alter state. */
  events: SimEvent[] | null;
}

export type PhaseFn = (state: SimState, buildings: Int32Array) => void;

export interface ModuleHooks {
  validateDraw?(state: SimState, from: number, to: number): RejectReason | null;
  onLineDrawn?(state: SimState, from: number, to: number, drawSeq: number): void;
  onLineCut?(state: SimState, from: number, to: number, reason: LineCutReason): void;
  onCapture?(state: SimState, building: number, from: number, to: number): void;
}

/** Sim-side binding of a defs module. `buildings` passed to a phase fn = indexes of buildings carrying the module. */
export interface SimModule {
  readonly id: ModuleId;
  /** Module columns `<id>.<field>`, value = initial word; allocated for every building and hashed. */
  readonly state?: Readonly<Record<string, number>>;
  init?(state: SimState, buildings: Int32Array): void;
  readonly phases?: Partial<Record<Phase, PhaseFn>>;
  readonly hooks?: ModuleHooks;
}

/** A module impl bound to one defs id: `id` is the literal, so a mismatch is a compile error. */
export type SimModuleFor<K extends ModuleId> = SimModule & { readonly id: K };

/** Why a draw is blocked and where (SP04 fills; web preview). `ref` = id of the blocking obstacle/building. */
export interface DrawExplanation { readonly reason: RejectReason; readonly point: { readonly x: number; readonly z: number }; readonly ref: string }
