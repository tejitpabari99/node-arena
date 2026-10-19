export const PIXEL_FALLBACK: { maxShare: number; maxDelta: number };
export interface RgbaDiff { width: number; height: number; total: number; differing: number; maxDelta: number; bbox: { x0: number; y0: number; x1: number; y1: number } | null }
export interface SizeMismatch { sizeMismatch: true; a: { w: number; h: number }; b: { w: number; h: number } }
export type ImageSource = string | { data: Uint8Array; type?: string };
export function compareRgba(a: ArrayLike<number>, b: ArrayLike<number>, width: number, height: number): RgbaDiff;
export interface PixelPage {
  page: unknown;
  decode(source: ImageSource): Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
  diff(a: ImageSource, b: ImageSource): Promise<RgbaDiff | SizeMismatch>;
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
  close(): Promise<void>;
}
export function openPixelPage(browser: unknown): Promise<PixelPage>;
