import type { RgbaDiff, SizeMismatch } from './pixels.mjs';
export interface PngJudgement { status: 'identical' | 'near' | 'fail'; reason?: string; diff?: RgbaDiff | SizeMismatch; share?: number }
export function judgePng(shaA: string | undefined, shaB: string | undefined, diff: RgbaDiff | SizeMismatch | null, limits?: { maxShare: number; maxDelta: number }): PngJudgement;
export function comparableMetrics(metrics: unknown, jobs: string[], relaxedPngs: Set<string>): Record<string, unknown>;
export function diffJson(a: unknown, b: unknown, at?: string, out?: string[]): string[];
export function verdict(input: { pngs: { status: string }[]; metricsDiffs: unknown[]; lintHits: unknown[] }): 'identical' | 'near-identical' | 'fail';
