import type { CompiledLevel as ContentCompiledLevel } from '@node-arena/content';
import type { ModuleId, Phase, RejectReason, SimEvent } from '@node-arena/defs';

export type CompiledLevel = ContentCompiledLevel;
export type LineCutReason = 'player' | 'replaced' | 'captured';
export type Outcome = 'won' | 'lost' | 'timeout';

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

export interface SimState {
  readonly level: CompiledLevel;
  readonly seed: number;
  tick: number;
  over: { outcome: Outcome; winner: number | null } | null;
  drawSeq: number;
  troopSeq: number;
  rejected: number;
  readonly buildings: Buildings;
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
