import type { CompiledLevel, ReplayHeader } from '@node-arena/content';
import type { Command } from '@node-arena/defs';
import { create, type Sim } from './sim.js';
import { TICK_RATE } from './math.js';
import type { SeatSetup, SimState } from './types.js';

type GameOver = NonNullable<SimState['over']>;
/** Authoritative versions from `content.json` (extra fields are ignored). */
export interface ReplayMetadata { rulesVersion: string; schemaVersion: string; contentVersion: string }
export type ReplayJson = null | boolean | number | string | ReplayJson[] | { [key: string]: ReplayJson };
export interface ReplayRecord {
  header: ReplayHeader;
  commands: { tick: number; cmd: ReplayJson }[];
  checkpoints: { tick: number; hash: string }[];
  /** Required even when recording stops before GameOver. */
  finalTick: number;
  finalHash: string;
  outcome: GameOver | null;
}
/** Compile outside sim: content is a type-only dependency. Tools can close over
 * loaded content in resolveLevel; browsers can supply an already compiled level.
 * Metadata must come from the authoritative content envelope, never defaults.
 */
export type ReplaySource = { metadata: ReplayMetadata } & (
  { level: CompiledLevel; resolveLevel?: never } | { resolveLevel(id: string): CompiledLevel; level?: never }
);
export interface ReplayRecorder extends Sim { record(): ReplayRecord }
export type ReplayResult = { ok: true; sim: Sim } | { ok: false; sim: Sim; divergingTick: number };

function invalid(): never { throw new Error('Invalid or incompatible replay'); }
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function tick(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2147483647;
}
function validHash(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{16}$/.test(value); }
function metadataValid(value: unknown): value is ReplayMetadata {
  return object(value) && ['rulesVersion', 'schemaVersion', 'contentVersion'].every(key => typeof value[key] === 'string' && /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value[key]));
}
function headerValid(value: unknown): value is ReplayHeader {
  return object(value) && typeof value.levelId === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(value.levelId) &&
    typeof value.simHash === 'string' && /^[0-9a-f]{64}$/.test(value.simHash) &&
    typeof value.seed === 'number' && Number.isInteger(value.seed) && value.seed >= 0 && value.seed <= 4294967295 && metadataValid(value) &&
    (value.teams === undefined || (Array.isArray(value.teams) && value.teams.every(t => typeof t === 'number' && Number.isInteger(t) && t >= 0)));
}
/** Refuse lossy JSON conversions (undefined, non-finite, prototypes, cycles). */
function json(value: unknown, ancestors = new Set<unknown>()): value is ReplayJson {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  ancestors.add(value);
  const valid = Array.isArray(value) ? Array.from(value).every(item => json(item, ancestors)) : Object.values(value).every(item => json(item, ancestors));
  ancestors.delete(value);
  return valid;
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function overValid(value: unknown): value is GameOver | null {
  return value === null || (object(value) && ['won', 'lost', 'timeout', 'victory', 'timeLimit', 'draw'].includes(value.outcome as string) && (value.winner === null || (typeof value.winner === 'number' && Number.isInteger(value.winner) && value.winner >= 0)) &&
    (value.winners === undefined || (Array.isArray(value.winners) && value.winners.every(w => typeof w === 'number' && Number.isInteger(w) && w >= 0))));
}
function validate(rec: unknown): asserts rec is ReplayRecord {
  if (!object(rec) || !headerValid(rec.header) || !tick(rec.finalTick) || !validHash(rec.finalHash) || !overValid(rec.outcome) || !Array.isArray(rec.commands) || !Array.isArray(rec.checkpoints)) invalid();
  let previous = -1;
  for (const entry of rec.commands) {
    if (!object(entry) || !tick(entry.tick) || entry.tick < previous || entry.tick >= rec.finalTick || !Object.hasOwn(entry, 'cmd') || !json(entry.cmd)) invalid();
    previous = entry.tick;
  }
  let expected = TICK_RATE;
  for (const checkpoint of rec.checkpoints) {
    if (!object(checkpoint) || checkpoint.tick !== expected || expected > rec.finalTick || !validHash(checkpoint.hash)) invalid();
    expected += TICK_RATE;
  }
  if (expected <= rec.finalTick) invalid();
}

/** Own the sim so no unrecorded steps can bypass the wrapper. Commands are
 * stamped with the current tick BEFORE step increments it and canonicalizes.
 * Postgame steps are inert, including recorder bookkeeping.
 */
export function createReplayRecorder(level: CompiledLevel, seed: number, metadata: ReplayMetadata, setup?: SeatSetup): ReplayRecorder {
  const header: ReplayHeader = { rulesVersion: metadata?.rulesVersion, schemaVersion: metadata?.schemaVersion, contentVersion: metadata?.contentVersion, levelId: level.id, simHash: level.simHash, seed, ...(setup !== undefined ? { teams: [...setup.teams] } : {}) };
  if (!headerValid(header)) invalid();
  const sim = create(level, seed, setup);
  const commands: ReplayRecord['commands'] = [], checkpoints: ReplayRecord['checkpoints'] = [];
  return {
    get view() { return sim.view; },
    get rejected() { return sim.rejected; },
    hash: () => sim.hash(),
    canDraw: (player, from, to) => sim.canDraw(player, from, to),
    explainDraw: (player, from, to) => sim.explainDraw(player, from, to),
    towerRadiusMilli: (view, building) => sim.towerRadiusMilli(view, building),
    readTroops: (buf) => sim.readTroops(buf),
    snapshot: () => sim.snapshot(),
    step(cmds, options) {
      if (sim.view.over) return sim.step(cmds, options);
      if (!json(cmds)) invalid();
      const submitted = clone(cmds) as unknown as ReplayJson[];
      for (const cmd of submitted) commands.push({ tick: sim.view.tick, cmd });
      // A separate clone keeps emitted rejection payloads from mutating history.
      const events = sim.step(clone(submitted) as unknown as Command[], options);
      if (sim.view.tick % TICK_RATE === 0) checkpoints.push({ tick: sim.view.tick, hash: sim.hash() });
      return events;
    },
    record() { return clone({ header, commands, checkpoints, finalTick: sim.view.tick, finalHash: sim.hash(), outcome: sim.view.over }); },
  };
}

/** Throws on malformed/incompatible input; state disagreements return the first
 * observable divergent checkpoint (or final tick). No bots run during playback.
 */
export function playReplay(content: ReplaySource, rec: ReplayRecord): ReplayResult {
  validate(rec);
  if (!metadataValid(content.metadata)) invalid();
  if (rec.header.rulesVersion.split('.', 2).join('.') !== content.metadata.rulesVersion.split('.', 2).join('.')) invalid();
  for (const key of ['schemaVersion', 'contentVersion'] as const) if (rec.header[key] !== content.metadata[key]) invalid();
  const level = content.level ?? content.resolveLevel(rec.header.levelId);
  if (level.id !== rec.header.levelId || level.simHash !== rec.header.simHash) invalid();
  if (level.objective !== 'pvp' && (rec.outcome !== null && !['won', 'lost', 'timeout'].includes(rec.outcome.outcome) || rec.outcome?.winners !== undefined)) invalid();
  const sim = create(level, rec.header.seed, rec.header.teams !== undefined ? { teams: rec.header.teams } : undefined);
  if (sim.view.timeLimitTicks > 0 && rec.finalTick > sim.view.timeLimitTicks) invalid();
  let commandIndex = 0, checkpointIndex = 0;
  while (sim.view.tick < rec.finalTick) {
    if (sim.view.over) return { ok: false, sim, divergingTick: sim.view.tick };
    const cmds: Command[] = [];
    while (commandIndex < rec.commands.length && rec.commands[commandIndex]!.tick === sim.view.tick) cmds.push(clone(rec.commands[commandIndex++]!.cmd) as unknown as Command);
    sim.step(cmds, { events: false });
    const checkpoint = rec.checkpoints[checkpointIndex];
    if (checkpoint?.tick === sim.view.tick) {
      if (sim.hash() !== checkpoint.hash) return { ok: false, sim, divergingTick: sim.view.tick };
      checkpointIndex++;
    }
  }
  if (sim.hash() !== rec.finalHash || sim.view.over?.outcome !== rec.outcome?.outcome || sim.view.over?.winner !== rec.outcome?.winner) return { ok: false, sim, divergingTick: sim.view.tick };
  return { ok: true, sim };
}
