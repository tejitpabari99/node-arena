import { growPeriodMt, TICK_MT } from '../timers.js';
import { stageOf } from '../state.js';
import type { SimModuleFor } from '../types.js';

/** Phase 3 (R-GRW-01): owned house with zero lines accrues; fire = level+1 (capped). Timer kept while lines exist. */
export const grows: SimModuleFor<'grows'> = {
  id: 'grows',
  state: { timer: 0 },
  phases: {
    growth(state, carriers) {
      const b = state.buildings;
      const timer = b.col['grows.timer']!;
      for (const i of carriers) {
        if (b.owner[i]! < 0 || b.lines[i]! !== 0) continue;
        const growTime = (state.level.buildings[i]!.modules['grows'] as { growTime: number }).growTime;
        timer[i]! += TICK_MT;
        const period = growPeriodMt(b.level[i]!, growTime, state.level.rules.growth.base);
        if (timer[i]! < period) continue;
        timer[i] = 0; // reset on fire (R-GRW-01)
        b.level[i] = Math.min(b.level[i]! + 1, b.maxLevel[i]!);
        b.stage[i] = stageOf(state.level.rules.stageThresholds, b.level[i]!);
      }
    },
  },
  hooks: {
    onCapture(state, building) {
      const timer = state.buildings.col['grows.timer'];
      if (timer) timer[building] = 0;
    },
  },
};
