export interface Limit { min?: number; max?: number; eq?: number; px?: boolean; atHeight?: number; [k: string]: unknown }
export interface MetricDef { name: string; source: string; status: 'cal' | 'prov'; threshold: string; note?: string; scenes: string[]; viewports: string[]; limits: Record<string, any> }
export interface Thresholds { schema: number; pxBaseHeight: number; gameScenes: string[]; metrics: Record<string, MetricDef> }
export interface Row { id: string; scene: string; viewport: string; status: 'pass' | 'fail' | 'info'; value: unknown; text: string }
export const TICK_RATE: number;
export const PROGRESS_PER_WORLD: number;
export const METRIC_IDS: string[];
export const PIXEL_IDS: string[];
export function loadThresholds(file?: string): Thresholds;
export function appliesTo(def: MetricDef, scene: string, viewport: string): boolean;
export function limitsFor(def: MetricDef, scene: string, viewport: string): any;
export function scaleLimit<T extends Limit | undefined>(limit: T, height: number, baseHeight?: number): T;
export function within(value: unknown, limit: Limit): boolean;
export function r3(v: unknown): number | null;
export function primaryFrame(entry: any): any;
export function roofLocator(t: any): { x: number; y: number; w: number; h: number };
export function headOn(ctx: any): { pass: boolean; value: any; text: string };
export function borderResult(b: any, limits: any): { pass: boolean; value: any; text: string };
export function paintResult(hsv: any, rect: any, team: string | null, owned: boolean, limits: any): { pass: boolean; owned: boolean; value: any };
export function mergePaint(rows: any[]): { pass: boolean; value: any; text: string };
export function roofDecalResult(hsv: any, towers: any[], limits: any): { pass: boolean; value: any; text: string };
export function stripesResult(hsv: any, towers: any[], limits: any): { pass: boolean; value: any; text: string };
export function evaluate(id: string, ctx: any): Omit<Row, 'scene' | 'viewport'>;
export function evaluateJob(input: { scene: string; viewport: string; entry: any; thresholds: Thresholds; run: any; refs: any; pixels(png: string): Promise<any> }): Promise<Row[]>;
export function prepareRef(spec: any, img: any): any;
export function calibrateRef(ref: any, others: any[], thresholds: Thresholds): Row[];
export function calibrateMock(hsv: import('./pixel-metrics.mjs').Hsv, quad: { x: number; y: number }[], thresholds: Thresholds, scene?: string): Row[];
export function formatTable(rows: Row[], thresholds: Thresholds): string;
export function summarize(rows: Row[]): Record<string, 'pass' | 'fail' | 'info' | 'missing'>;
