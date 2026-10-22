import { spawnPeriodMt, TICK_MT } from '../timers.js';
import { channelKey, spawnTroop } from '../state.js';
import type { SimModuleFor } from '../types.js';

/** Phase 4 (R-SPN-01..03): per-line milli-tick timers; buildings by index, lines by target index. */
export const spawns: SimModuleFor<'spawns'> = {
  id: 'spawns',
  phases: {
    spawn(state, carriers) {
      const b = state.buildings;
      for (const from of carriers) {
        if (b.owner[from]! < 0) continue;
        const params = state.level.buildings[from]!.modules['spawns'] as { troop: string; spawnSpeed: number; lineSpawnPenalty: number };
        const kind = state.unitOf[from]!;
        for (let to = 0; to < b.n; to++) {
          const ch = state.channels.get(channelKey(state, from, to));
          if (!ch || !ch.drawn) continue;
          ch.timer += TICK_MT;
          const period = spawnPeriodMt(b.level[from]!, b.lines[from]!, params.spawnSpeed, params.lineSpawnPenalty);
          if (ch.timer < period) continue;
          ch.timer -= period;
          if (b.alive[from]! >= state.level.rules.aliveCap) continue; // skipped, timer still consumed
          const seq = spawnTroop(state, from, to, kind);
          state.events?.push({ type: 'TroopSpawned', channel: ch.key, seq, owner: b.owner[from]!, kind: params.troop, cause: 'timer' });
        }
      }
    },
  },
};
