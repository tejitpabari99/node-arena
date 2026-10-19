import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareRgba, PIXEL_FALLBACK } from '../visual/lib/pixels.mjs';
import { BANNED, DEFAULT_ROOTS, lintDeterminism } from '../visual/lib/lint-determinism.mjs';
import { comparableMetrics, diffJson, judgePng, verdict } from '../visual/lib/selfcheck.mjs';
import { mulberry32, seededRandom } from '../src/render/rng';

const rgba = (n: number, fill = 10) => new Uint8ClampedArray(n * 4).fill(fill);

describe('pixels.compareRgba (SP01 Task 4)', () => {
  it('reports identical buffers as 0 differing pixels', () => {
    expect(compareRgba(rgba(6), rgba(6), 3, 2)).toMatchObject({ total: 6, differing: 0, maxDelta: 0, bbox: null });
  });
  it('counts differing pixels, the max channel delta and their bbox', () => {
    const a = rgba(12), b = rgba(12);
    b[(1 * 4 + 2) * 4 + 1] = 12; // x=2,y=1 G +2
    b[(2 * 4 + 3) * 4 + 3] = 3; // x=3,y=2 A -7
    expect(compareRgba(a, b, 4, 3)).toEqual({ width: 4, height: 3, total: 12, differing: 2, maxDelta: 7, bbox: { x0: 2, y0: 1, x1: 3, y1: 2 } });
  });
  it('fails on a size mismatch', () => {
    expect(() => compareRgba(rgba(4), rgba(6), 2, 2)).toThrow(/size/);
  });
});

describe('selfcheck judging (PRD AC: identical hashes, fallback <=0.01% px with delta <=2)', () => {
  const diff = (differing: number, maxDelta: number, total = 1920 * 1080) => ({ width: 1920, height: 1080, total, differing, maxDelta, bbox: null });
  it('uses the PRD fallback limits', () => expect(PIXEL_FALLBACK).toEqual({ maxShare: 0.0001, maxDelta: 2 }));
  it('identical hashes => identical', () => expect(judgePng('a', 'a', null).status).toBe('identical'));
  it('1 px delta 1 => near-identical', () => expect(judgePng('a', 'b', diff(1, 1)).status).toBe('near'));
  it('delta 3 => fail', () => expect(judgePng('a', 'b', diff(1, 3)).status).toBe('fail'));
  it('more than 0.01% pixels => fail', () => expect(judgePng('a', 'b', diff(208, 1)).status).toBe('fail'));
  it('missing file => fail', () => expect(judgePng('a', undefined, null).status).toBe('fail'));
  it('verdict: any fail or lint hit fails, any near is near-identical', () => {
    expect(verdict({ pngs: [{ status: 'identical' }], metricsDiffs: [], lintHits: [] })).toBe('identical');
    expect(verdict({ pngs: [{ status: 'near' }], metricsDiffs: [], lintHits: [] })).toBe('near-identical');
    expect(verdict({ pngs: [{ status: 'identical' }], metricsDiffs: ['x'], lintHits: [] })).toBe('fail');
    expect(verdict({ pngs: [{ status: 'identical' }], metricsDiffs: [], lintHits: [{}] })).toBe('fail');
    expect(verdict({ pngs: [], metricsDiffs: [], lintHits: [] })).toBe('fail');
  });
  it('comparableMetrics drops perf everywhere and sha256 only of relaxed (near-identical) frames', () => {
    const metrics = { schema: 1, scenes: { l01: { '1366x768': { perf: { fps: 3 }, frames: [
      { png: 'l01-1366x768.png', sha256: 'x', probe: { perf: 1, n: 2 }, laneCrop: { sha256: 'c' } },
      { png: 'l01-1366x768-b.png', sha256: 'y' },
    ] } }, menu: { '1366x768': { frames: [] } } } };
    const out = comparableMetrics(metrics, ['l01@1366x768'], new Set(['l01-1366x768.png']));
    expect(out).toEqual({ 'l01@1366x768': { frames: [{ png: 'l01-1366x768.png', probe: { n: 2 }, laneCrop: {} }, { png: 'l01-1366x768-b.png', sha256: 'y' }] } });
    expect(comparableMetrics(metrics, ['nope@1x1'], new Set())).toEqual({ 'nope@1x1': null });
  });
  it('diffJson lists differing paths', () => {
    expect(diffJson({ a: 1, b: [1, { c: 2 }] }, { a: 1, b: [1, { c: 3 }] })).toEqual(['$.b[1].c: 2 != 3']);
    expect(diffJson({ a: 1 }, { a: 1, z: null })).toEqual(['$.z: undefined != null']);
    expect(diffJson([1], [1, 2])).toEqual(['$.length: 1 != 2']);
    expect(diffJson({ x: { y: 1 } }, { x: { y: 1 } })).toEqual([]);
  });
});

describe('lint-determinism (N6)', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'na-lint-'));
  it('bans the four time/random sources and scans src/render + src/fx', () => {
    expect(BANNED.source).toBe('Math\\.random|crypto\\.getRandomValues|Date\\.now|performance\\.now');
    expect(DEFAULT_ROOTS).toEqual(['src/render', 'src/fx']);
  });
  it('the real renderer is clean', () => expect(lintDeterminism()).toEqual([]));
  it('reports every hit with file and line; skips test-harness and perf-allowed lines', () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'render/sub'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'render/test-harness'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'render/a.ts'), 'const ok = 1;\nconst j = Math.random() * 2;\n');
    fs.writeFileSync(path.join(dir, 'render/sub/b.tsx'), 'const t = Date.now(); const r = crypto.getRandomValues(x);\n');
    fs.writeFileSync(path.join(dir, 'render/c.ts'), 'const t0 = performance.now(); // determinism-allow: perf sampling\n');
    fs.writeFileSync(path.join(dir, 'render/test-harness/h.ts'), 'Math.random();\n');
    fs.writeFileSync(path.join(dir, 'render/notes.md'), 'Math.random\n');
    const hits = lintDeterminism({ cwd: dir, roots: ['render', 'fx'] });
    expect(hits.map(h => `${h.file}:${h.line}:${h.match}`)).toEqual(['render/a.ts:2:Math.random', 'render/sub/b.tsx:1:Date.now', 'render/sub/b.tsx:1:crypto.getRandomValues']);
  });
});

describe('render rng (mulberry32 seeded from (pairKey, tick))', () => {
  it('mulberry32 matches the reference (bryc) sequence', () => {
    const r = mulberry32(1);
    const seq = [r(), r(), r()];
    expect(seq.map(v => v.toFixed(10))).toEqual(['0.6270739406', '0.0027357212', '0.5274470400']);
  });
  it('seededRandom depends only on (pairKey, tick)', () => {
    const a = seededRandom('0-3', 120), b = seededRandom('0-3', 120);
    expect([a(), a()]).toEqual([b(), b()]);
    expect(seededRandom('0-3', 121)()).not.toBe(seededRandom('0-3', 120)());
    expect(seededRandom('1-3', 120)()).not.toBe(seededRandom('0-3', 120)());
    for (let i = 0, r = seededRandom('x', 0); i < 100; i++) { const v = r(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
});
