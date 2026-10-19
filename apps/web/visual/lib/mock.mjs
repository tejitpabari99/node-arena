// Calibration (b) (PRD SP01 Iteration protocol step 4b): renders visual/calib/mock-landscape.html, a 1920x1080 landscape
// mock built only from ref pixels, and returns its RGBA frame + play quad for calibrateMock (M09/M10/M14).
// Refs go in as data URLs (no file:// access, canvas stays readable); refs are never modified.
import fs from 'node:fs';
import path from 'node:path';
import { VISUAL_DIR } from './scenes.mjs';

export const MOCK_FILE = path.join(VISUAL_DIR, 'calib', 'mock-landscape.html');
export const MOCK_REFS = { tw01: 'towerwar_01.jpg', yt1: 'towerwar_yt1.jpg' };

const dataUrl = file => `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`;

/** -> { img: {width,height,data}, quad: [{x,y}x4], png: Buffer } */
export async function renderMock(browser, pixels, refDir, file = MOCK_FILE) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(fs.readFileSync(file, 'utf8'));
    const refs = Object.fromEntries(Object.entries(MOCK_REFS).map(([k, f]) => [k, dataUrl(path.join(refDir, f))]));
    const out = await page.evaluate(r => window.renderMock(r), refs);
    const png = Buffer.from(out.png.slice(out.png.indexOf(',') + 1), 'base64');
    const img = await pixels.decode({ data: png, type: 'image/png' });
    if (img.width !== out.width || img.height !== out.height) throw new Error(`mock size ${img.width}x${img.height} != ${out.width}x${out.height}`);
    return { img, quad: out.quad, png };
  } finally { await page.close(); }
}
