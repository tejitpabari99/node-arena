// Importer core (PRD 07 R3): extract -> {path: bytes} + lock. No writes here; cli.ts does fs. Deterministic: jobs run in a fixed
// order, outputs are sorted by path, no timestamps. Task 4 added envJob.
import { createHash } from 'node:crypto';
import { buildingsJob, projectileJob } from './buildings.js';
import { envJob } from './env.js';
import { Extract } from './extract.js';
import { fxJob } from './fx.js';
import { fragmentOutputs } from './manifest-fragment.js';
import type { Job, Output } from './output.js';
import { unitsJob } from './units.js';

export const JOBS: readonly Job[] = [unitsJob, buildingsJob, projectileJob, fxJob, envJob];

export interface ImportResult {
  /** Path relative to apps/web/assets -> bytes, sorted by path. */
  files: Map<string, Uint8Array>;
  /** Exact text of tools/assets/tw-extract.lock.json. */
  lock: string;
}

/** Runs after the jobs, sees every generated file (not the extract). The default job list also emits `manifest.tw.json`. */
export type Finalizer = (files: ReadonlyMap<string, Uint8Array>) => Promise<Output[]>;

export async function runImport(extractRoot: string, jobs: readonly Job[] = JOBS, finalize: Finalizer | null = jobs === JOBS ? fragmentOutputs : null): Promise<ImportResult> {
  const ex = new Extract(extractRoot);
  const all: Output[] = [];
  for (const job of jobs) all.push(...(await job(ex)));
  if (finalize) all.push(...(await finalize(new Map(all.map((o) => [o.path, o.bytes] as const)))));
  all.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const files = new Map<string, Uint8Array>();
  for (const o of all) {
    if (files.has(o.path)) throw new Error(`duplicate output ${o.path}`);
    files.set(o.path, o.bytes);
  }
  const inputs: Record<string, string> = {};
  for (const k of [...ex.inputs.keys()].sort()) inputs[k] = ex.inputs.get(k)!;
  const outputs: Record<string, string> = {};
  for (const [p, bytes] of files) outputs[p] = createHash('sha256').update(bytes).digest('hex');
  // `outputs` lets `check:manifest` verify the committed assets without the source extract.
  const lock = JSON.stringify({ format: 2, note: '`inputs`: sha256 of every file read from TW_EXTRACT (paths relative to it); `outputs`: sha256 of every generated file (paths relative to apps/web/assets); written by `pnpm assets:tw`', inputs, outputs }, null, 2) + '\n';
  return { files, lock };
}
