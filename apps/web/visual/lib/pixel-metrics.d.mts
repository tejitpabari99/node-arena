export interface Rgba { width: number; height: number; data: Uint8ClampedArray }
export interface Hsv { width: number; height: number; h: Float32Array; s: Float32Array; v: Float32Array; data: Uint8ClampedArray }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Blob { x0: number; y0: number; x1: number; y1: number; w: number; h: number; n: number; pixels: number[]; outline?: number }
export const FG_MIN_V: number;
export const DIGIT: { maxS: number; minV: number; outlineV: number; outlineRadius: number; minOutlineShare: number; minPixels: number; [k: string]: number };
export const REF_TOWER_WIDTH: number;
export function toHsv(img: Rgba): Hsv;
export function crop(img: Rgba, rect: Rect): Rgba | null;
export function resample(img: Rgba, width: number): Rgba;
export function polygonMask(width: number, height: number, points: { x: number; y: number }[]): Uint8Array;
export function rectMask(width: number, height: number, rect: Rect): Uint8Array;
export function voidShare(img: Rgba): number;
export function grassShare(hsv: Hsv, mask?: Uint8Array | null, inside?: boolean): number | null;
export function playQuadShares(hsv: Hsv, mask: Uint8Array): { grassInside: number | null; border: { sandRock: number | null; grass: number | null; area: number } };
export function towerPaint(hsv: Hsv, rect: Rect, team: string | null): { fg: number; a?: number | null; b?: number; c?: number; sat?: number; greyWhite?: number } | null;
export function classVector(hsv: Hsv, rect?: Rect | null, opts?: { fgOnly?: boolean }): number[] | null;
export function tvDistance(a: number[] | null, b: number[] | null): number | null;
export function components(hsv: Hsv, rect: Rect, pred: (p: number) => boolean): Blob[];
export function outlineShare(hsv: Hsv, comp: Blob): number;
export function roofRegion(rect: Rect): Rect;
export function whiteBlobs(hsv: Hsv, rect: Rect): Blob[];
export function digitHeight(hsv: Hsv, locator: Rect): number | null;
export function outlinedDigit(hsv: Hsv, locator: Rect): Blob | null;
export function slotDots(hsv: Hsv, towerRect: Rect, digit: Blob | null, team: string | null): number;
export function floorStripes(hsv: Hsv, rect: Rect, team: string, fromY?: number): { whiteRuns: number; bands: number; teamRuns: number } | null;
