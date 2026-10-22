import { liveChannels, progressOf, stageOf } from './state.js';
import type { SimState } from './types.js';

function fail(message: string): never { throw new Error(`invariant: ${message}`); }
const isInt32 = (v: number): boolean => Number.isInteger(v) && v >= -2147483648 && v <= 2147483647;

/** Debug check of R2 invariants; throws on the first violation. Not for hot paths. */
export function assertInvariants(state: SimState): void {
  const b = state.buildings, n = b.n, cap = state.level.rules.aliveCap;
  for (const [name, col] of [['owner', b.owner], ['level', b.level], ['maxLevel', b.maxLevel], ['lines', b.lines], ['alive', b.alive], ...Object.entries(b.col)] as const) {
    for (let i = 0; i < col.length; i++) if (!isInt32(col[i]!)) fail(`${name}[${i}] not int32`);
  }
  for (const v of [state.tick, state.drawSeq, state.troopSeq]) if (!isInt32(v)) fail('global not int32');
  const lines = new Int32Array(n), alive = new Int32Array(n);
  for (const ch of liveChannels(state)) {
    const r = ch.troops;
    if (ch.key !== ch.from * n + ch.to) fail(`channel ${ch.key} key mismatch`);
    if (ch.drawn !== 0 && ch.drawn !== 1) fail(`channel ${ch.key} drawn flag`);
    if (ch.drawn && b.owner[ch.from] === -1) fail(`channel ${ch.key} drawn from neutral`);
    if (!isInt32(ch.drawSeq) || !isInt32(ch.timer) || ch.timer < 0) fail(`channel ${ch.key} drawSeq/timer`);
    if (ch.drawn) lines[ch.from]!++;
    if (r.len > cap) fail(`channel ${ch.key} ring ${r.len} > aliveCap ${cap}`);
    alive[ch.from]! += r.len;
    let previous = Infinity;
    for (let i = 0; i < r.len; i++) {
      if (r.owner[i] !== r.owner[0]) fail(`channel ${ch.key} mixed owners`);
      for (const col of [r.p0, r.t0, r.owner, r.kind, r.seq, r.hp]) if (!isInt32(col[i]!)) fail(`channel ${ch.key} ring not int32`);
      if (r.hp[i]! <= 0) fail(`channel ${ch.key} row ${i} hp <= 0`);
      const progress = progressOf(state, ch, i);
      if (progress > previous) fail(`channel ${ch.key} FIFO not monotone at row ${i}`);
      previous = progress;
    }
  }
  let totalAlive = 0;
  for (let i = 0; i < n; i++) {
    if (b.level[i]! < 0 || b.level[i]! > b.maxLevel[i]!) fail(`building ${i} level out of range`);
    if (b.stage[i] !== stageOf(state.level.rules.stageThresholds, b.level[i]!)) fail(`building ${i} stage ${b.stage[i]} != stageOf(level)`);
    if (lines[i] !== b.lines[i]) fail(`building ${i} lines ${b.lines[i]} != recount ${lines[i]}`);
    if (alive[i] !== b.alive[i]) fail(`building ${i} alive ${b.alive[i]} != recount ${alive[i]}`);
    if (b.alive[i]! > cap) fail(`building ${i} alive over cap`);
    totalAlive += b.alive[i]!;
  }
  const c = state.counters;
  if (c.spawned !== totalAlive + c.arrived + c.died + c.killed) fail(`conservation: spawned ${c.spawned} != alive ${totalAlive} + arrived ${c.arrived} + died ${c.died} + killed ${c.killed}`);
}
