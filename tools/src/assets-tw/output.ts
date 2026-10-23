import type { Extract } from './extract.js';

/** One generated file. `path` is posix, relative to apps/web/assets. */
export interface Output { path: string; bytes: Uint8Array }
/** An importer job: reads the extract, returns files. Task 4 adds environment/obstacle jobs to JOBS in run.ts. */
export type Job = (ex: Extract) => Promise<Output[]>;
