export const PRIMARY_VIEWPORT: string;
export const CROP_PX: number;
export interface RefEntry { file: string; role: 'look' | 'chevrons' | string; items?: string[]; note?: string }
export interface RefMap { scenes: Record<string, { refs: RefEntry[]; items?: string[] }> }
export interface Box { x: number; y: number; w: number; h: number }
export interface Crop { key: 'tower' | 'lane' | 'troops' | 'clash'; title: string; rect: Box | null; text: string }
export function loadRefMap(file?: string): RefMap;
export function loadTemplate(file?: string): string;
export function validateRefMap(map: unknown, scenesConfig: { scenes: { id: string }[] }, refFiles: string[]): string[];
export function cropBox(p: { x: number; y: number }, size: number, viewport: { width: number; height: number }): Box;
export function troopCluster(rects: Box[] | undefined, radius: number): { x: number; y: number; n: number } | null;
export function detailCrops(frame: Record<string, any>, viewport: { width: number; height: number }): Crop[];
export interface ComposeFrame { label: string | null; tick: number | null; simHash: string | null; screen: string | null; src: string; png: string; w: number; h: number }
export interface ComposeModel {
  id: string; title: string; meta: string;
  current: { viewport: string; primary: boolean; frames: ComposeFrame[] }[];
  refs: (RefEntry & { width: number; height: number; src: string; w: number; h: number })[];
  crops: (Crop & { box: { w: number; h: number } })[];
  cropSource: string; frameLabel(f: ComposeFrame): string;
}
export function composeModel(input: { scene: { id: string; screen?: string }; byViewport: Record<string, any>; refs: (RefEntry & { width: number; height: number })[]; outDir: string; refDir: string; commit?: string | null }): ComposeModel;
export function escapeHtml(s: unknown): string;
export function renderHtml(template: string, model: ComposeModel): string;
export function imageSize(buf: Buffer): { width: number; height: number };
