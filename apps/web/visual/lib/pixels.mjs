// Shared pixel helper (PRD SP01 Architecture "Pixel metrics"): images are decoded in a second blank
// Chromium page (bytes -> createImageBitmap -> canvas -> getImageData); no native image libs.
// Used by visual:selfcheck (PNG diff) and later by the pixel metrics / visual:calibrate (ref JPEGs).
import fs from 'node:fs';
import path from 'node:path';

/** PRD AC fallback for "byte-identical": <=0.01% of pixels differ and no channel differs by more than 2. */
export const PIXEL_FALLBACK = { maxShare: 0.0001, maxDelta: 2 };

/**
 * Pure RGBA comparison (also run inside the page via its source text, so keep it self-contained).
 * Returns differing pixel count, max per-channel delta and the bbox of differing pixels.
 */
export function compareRgba(a, b, width, height) {
  const total = width * height;
  if (a.length !== total * 4 || b.length !== total * 4) throw new Error(`size mismatch: ${a.length}/${b.length} bytes for ${width}x${height}`);
  let differing = 0, maxDelta = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3]));
    if (d === 0) continue;
    differing++;
    if (d > maxDelta) maxDelta = d;
    const x = p % width, y = (p - x) / width;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { width, height, total, differing, maxDelta, bbox: differing ? { x0, y0, x1, y1 } : null };
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/** `source`: file path or { data: Buffer, type?: mime }. */
function encode(source) {
  if (typeof source === 'string') return { b64: fs.readFileSync(source).toString('base64'), type: MIME[path.extname(source).toLowerCase()] ?? 'image/png' };
  return { b64: Buffer.from(source.data).toString('base64'), type: source.type ?? 'image/png' };
}

/** In-page decoder (installed once per pixel page). Raw bytes: no colour-space conversion, no premultiply. */
function installDecoder() {
  window.__pxDecode = async ({ b64, type }) => {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bitmap = await createImageBitmap(new Blob([bytes], { type }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    ctx.drawImage(bitmap, 0, 0);
    const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height, { colorSpace: 'srgb' });
    bitmap.close();
    return image;
  };
}

/**
 * Opens a second blank page on `browser` for decoding. Methods:
 * - decode(source) -> { width, height, data: Uint8ClampedArray } (RGBA, 8-bit sRGB)
 * - diff(sourceA, sourceB) -> compareRgba result, or { sizeMismatch: true, a:{w,h}, b:{w,h} }
 * - evaluate(fn, arg) -> runs fn(arg) in the pixel page (for in-page metrics on decoded images)
 */
export async function openPixelPage(browser) {
  const page = await browser.newPage();
  await page.goto('about:blank');
  await page.evaluate(`(${installDecoder.toString()})()`);
  await page.evaluate(src => { window.__pxCompare = new Function(`return (${src})`)(); }, compareRgba.toString());
  return {
    page,
    async decode(source) {
      const { width, height, b64 } = await page.evaluate(async img => {
        const d = await window.__pxDecode(img);
        let bin = '';
        for (let i = 0; i < d.data.length; i += 0x8000) bin += String.fromCharCode.apply(null, d.data.subarray(i, i + 0x8000));
        return { width: d.width, height: d.height, b64: btoa(bin) };
      }, encode(source));
      return { width, height, data: new Uint8ClampedArray(Buffer.from(b64, 'base64')) };
    },
    async diff(sourceA, sourceB) {
      return page.evaluate(async ([a, b]) => {
        const [ia, ib] = await Promise.all([window.__pxDecode(a), window.__pxDecode(b)]);
        if (ia.width !== ib.width || ia.height !== ib.height) return { sizeMismatch: true, a: { w: ia.width, h: ia.height }, b: { w: ib.width, h: ib.height } };
        return window.__pxCompare(ia.data, ib.data, ia.width, ia.height);
      }, [encode(sourceA), encode(sourceB)]);
    },
    evaluate: (fn, arg) => page.evaluate(fn, arg),
    close: () => page.close(),
  };
}
