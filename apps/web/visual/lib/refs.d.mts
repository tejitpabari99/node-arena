export const REPO_DIR: string;
export function resolveRefDir(env?: Record<string, string | undefined>, repo?: string): string;
export function loadRefCalib(file?: string): { refs: Record<string, unknown>[] } & Record<string, unknown>;
export function loadRefs(pixels: unknown, calib?: unknown, dir?: string): Promise<unknown[]>;
