export const ITEM_IDS: string[];
export interface ChecklistItem { id: string; item: string; scenes: string[]; refs: string; a4: string; a6: string; a8: string; a10: string; pixel: string; owner: string }
export interface ChecklistMetric { id: string; metric: string; source: string; threshold: string; calibration: string; status: string }
export interface ChecklistLimit { id: string; status: string; scenes: string[]; viewports: string[]; limits: unknown }
export interface Checklist { items: ChecklistItem[]; metrics: ChecklistMetric[]; limits: ChecklistLimit[]; towerLook: string; errors: string[] }
export interface RefMapLike { scenes: Record<string, { refs: { file: string; role: string; items?: string[]; note?: string }[]; items?: string[] }> }
export function resolveChecklist(env?: Record<string, string | undefined>, repo?: string): string;
export function splitRow(line: string): string[];
export function parseChecklist(md: string): Checklist;
export function loadChecklist(file?: string): Checklist;
export function checkConsistency(checklist: Checklist, thresholds: unknown): string[];
export function stripMetricRefs(text: string): string;
export function itemsForScene(checklist: Checklist, refMap: RefMapLike, scene: string): ChecklistItem[];
export function scoreSheet(opts: { checklist: Checklist; refMap: RefMapLike; scene: string; refDir: string; outDir: string }): string;
export interface MergedItem { self: number | null; selfRaw: number | null; blind: number | null; blindRaw: number | null; merged: number | null; diff: number | null; flags: string[]; differences: { self: string[]; blind: string[] } }
export function mergeScores(self: unknown, blind: unknown): { schema: 1; items: Record<string, MergedItem>; flagged: string[]; missing: string[] };
