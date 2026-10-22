// Importer core (PRD 07 R3): extract -> {path: bytes} + lock. No writes here; cli.ts does fs. Deterministic: jobs run in a fixed
// order, outputs are sorted by path, no timestamps. Task 4 appends environment/obstacle jobs to JOBS.
import { buildingsJob, projectileJob } from './buildings.js';
import { Extract } from './extract.js';
import { fxJob } from './fx.js';
import type { Job, Output } from './output.js';
import { unitsJob } from './units.js';

export const JOBS: readonly Job[] = [unitsJob, buildingsJob, projectileJob, fxJob];

export interface ImportResult {
  /** Path relative to apps/web/assets -> bytes, sorted by path. */
  files: Map<string, Uint8Array>;
  /** Exact text of tools/assets/tw-extract.lock.json. */
  lock: string;
}

export async function runImport(extractRoot: string, jobs: readonly Job[] = JOBS): Promise<ImportResult> {
  const ex = new Extract(extractRoot);
  const all: Output[] = [];
  for (const job of jobs) all.push(...(await job(ex)));
  all.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const files = new Map<string, Uint8Array>();
  for (const o of all) {
    if (files.has(o.path)) throw new Error(`duplicate output ${o.path}`);
    files.set(o.path, o.bytes);
  }
  const inputs: Record<string, string> = {};
  for (const k of [...ex.inputs.keys()].sort()) inputs[k] = ex.inputs.get(k)!;
  const lock = JSON.stringify({ format: 1, note: 'sha256 of every file read from TW_EXTRACT (paths relative to it); written by `pnpm assets:tw`', inputs }, null, 2) + '\n';
  return { files, lock };
}
