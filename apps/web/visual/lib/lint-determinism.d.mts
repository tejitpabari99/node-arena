export const BANNED: RegExp;
export const DEFAULT_ROOTS: string[];
export interface LintHit { file: string; line: number; column: number; match: string; text: string }
export function lintDeterminism(opts?: { cwd?: string; roots?: string[] }): LintHit[];
export function formatHits(hits: LintHit[]): string;
