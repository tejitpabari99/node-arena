import type { CompiledLevel } from '@node-arena/content';
import type { Command } from '@node-arena/defs';

export interface Scenario {
  name: string;
  purpose: string;
  fullGame: boolean;
  level: CompiledLevel;
  seed: number;
  ticks: number;
  commands: { tick: number; cmd: Command }[];
}
/** v1 scenarios died with the v1 engine at CUT; SP03 authors the v2 set and un-parks `sim:golden`. */
export const scenarios: Scenario[] = [];
