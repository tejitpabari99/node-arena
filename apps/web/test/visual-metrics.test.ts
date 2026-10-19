import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isGrass, isGrey, isMagenta, isRock, isSand, isTeamSat, isWhite, nearestTeam, rgbToHsv } from '../visual/lib/color.mjs';
import { calibrateMock, evaluate, evaluateJob, headOn, limitsFor, loadThresholds, METRIC_IDS, prepareRef, scaleLimit, summarize, within } from '../visual/lib/metrics.mjs';
import { digitHeight, floorStripes, outlinedDigit, slotDots, playQuadShares, polygonMask, REF_TOWER_WIDTH, toHsv, towerPaint, tvDistance, voidShare } from '../visual/lib/pixel-metrics.mjs';

const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] as const;
const hsv = (h: string) => rgbToHsv(...hex(h));
/** Solid image filled by `paint(x, y)` -> '#rrggbb'. */
function image(width: number, height: number, paint: (x: number, y: number) => string) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b] = hex(paint(x, y)), i = (y * width + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { width, height, data };
}
const thresholds = loadThresholds();

describe('color.mjs (PRD Colour spec: HSV from 8-bit sRGB, colorsys convention)', () => {
  it('converts like colorsys.rgb_to_hsv', () => {
    const [h, s, v] = hsv('#FFE1B3'); // PRD: H36 S.30 V1.0
    expect(Math.round(h)).toBe(36); expect(s).toBeCloseTo(0.298, 2); expect(v).toBe(1);
    const [h2, s2, v2] = hsv('#BC5439'); // PRD: H12 S.69 V.74
    expect(Math.round(h2)).toBe(12); expect(s2).toBeCloseTo(0.697, 2); expect(v2).toBeCloseTo(0.737, 2);
    expect(rgbToHsv(0, 0, 255)[0]).toBe(240); expect(rgbToHsv(255, 0, 128)[0]).toBeCloseTo(329.88, 1);
  });
  it('classifies the PRD palette samples (sand #FFE1B3, rock #BC5439; the retired HSL rules failed them)', () => {
    expect(isSand(...hsv('#FFE1B3'))).toBe(true);
    expect(isRock(...hsv('#BC5439'))).toBe(true);
    expect(isGrass(...hsv('#8CD62A'))).toBe(true); // H~86 S.80 V.84 (tw01-like grass)
    expect(isGrass(...hsv('#3060C0'))).toBe(false);
    expect(isWhite(...hsv('#F0F0F0'))).toBe(true);
    expect(isGrey(...hsv('#8C8C8C'))).toBe(true); expect(isGrey(...hsv('#F0F0F0'))).toBe(false);
    expect(isTeamSat(...hsv('#2F7DE1'), 212)).toBe(true); // blue roof ~H213
    expect(isTeamSat(...hsv('#E12F3A'), 212)).toBe(false);
  });
  it('maps a paint hue to the nearest team; null for no hue', () => {
    expect(nearestTeam(205)).toBe('blue'); expect(nearestTeam(2)).toBe('red'); expect(nearestTeam(48)).toBe('yellow'); expect(nearestTeam(null)).toBe(null);
  });
  it('magenta void is #FF00FF +-6 per channel', () => {
    expect(isMagenta(255, 0, 255)).toBe(true); expect(isMagenta(249, 6, 249)).toBe(true); expect(isMagenta(248, 0, 255)).toBe(false);
  });
});

describe('thresholds.json (PRD Metrics table verbatim)', () => {
  const prd = (() => {
    const base = path.resolve(__dirname, '../../../docs/agent_files');
    const dir = fs.readdirSync(base).filter(d => d.includes('visual-mechanics-overhaul')).sort().at(-1)!;
    return fs.readFileSync(path.join(base, dir, '01-visual-qa-harness', 'PRD.md'), 'utf8');
  })();
  const rows = prd.split('\n').filter(l => /^\| M\d\d \|/.test(l)).map(l => { const c = l.split('|').map(s => s.trim()); return { id: c[1]!, threshold: c[c.length - 4]!, status: c[c.length - 2]! }; });
  it('has M01-M20, each with the PRD threshold text and status', () => {
    expect(rows.map(r => r.id)).toEqual(METRIC_IDS);
    expect(Object.keys(thresholds.metrics)).toEqual(METRIC_IDS);
    for (const r of rows) expect({ id: r.id, threshold: thresholds.metrics[r.id]!.threshold, status: thresholds.metrics[r.id]!.status }).toEqual(r);
  });
  it('machine limits encode the PRD numbers', () => {
    const m = thresholds.metrics;
    // T8 M01 per the PRD letter: share of viewport WIDTH. Calibrated band 4.35-8.75% of viewport height (refs tw01 ~5.8%,
    // yt1 ~7% of height, +-25% V01 8-anchor) converted at 16:9 (both gated viewports): x 9/16 -> 2.45-4.92% of width.
    expect(m.M01!.viewports).toEqual(['1920x1080', '1366x768']);
    for (const v of m.M01!.viewports) {
      const [w, h] = v.split('x').map(Number); expect(w! / h!).toBeCloseTo(16 / 9, 2);
      for (const scene of ['l01', 'l10', 'l10cb', 'l18']) expect(limitsFor(m.M01!, scene, v)).toEqual({ min: 0.0245, max: 0.0492 });
    }
    expect(0.0435 * 9 / 16).toBeCloseTo(m.M01!.limits.min, 4); expect(0.0875 * 9 / 16).toBeCloseTo(m.M01!.limits.max, 4);
    expect(m.M02!.limits.ratio).toEqual({ min: 0.14, max: 0.30 });
    expect(m.M05!.limits.ratio).toEqual({ min: 0.20, max: 0.40 }); // T8: refs tw01 0.23-0.26, yt1 0.22-0.28
    expect(m.M06!.limits).toEqual({ heightShare: { min: 0.02 }, perTowerWidth: { min: 0.30, max: 0.60 } }); // T8: tightened from 0.015 / 0.22 on ref troop measurements
    expect(m.M07!.limits.share).toEqual({ max: 0.005 }); expect(m.M07!.viewports).toContain('1920x1200');
    expect(m.M08!.viewports).toContain('1920x1200');
    expect(m.M10!.limits).toEqual({ sandRock: { min: 0.60 }, grass: { max: 0.05 }, area: { min: 0.10 } });
    expect(m.M11!.limits).toEqual({ a: { min: 0.85 }, b: { min: 0.35, max: 0.72 }, c: { min: 0.15, max: 0.45 }, neutralSat: { max: 0.05 }, neutralGreyWhite: { min: 0.90 } });
    expect(m.M12!.limits.splitErrorPx).toEqual({ max: 12, px: true });
    expect(m.M14!.limits.share).toEqual({ min: 0.30, max: 0.60 });
    expect(m.M15!.limits).toEqual({ minMargin: { min: 0.02 }, unionMargin: { max: 0.10 } });
    expect(m.M18!.limits).toEqual({ frame: { max: 0.20 }, tower: { max: 0.20 } });
  });
  it('M16 floors follow the PRD rule: ref crops at the M01 floor at 1366x768 (33 px), min ref glyph over +-2 px (T8: 5 px L1, 4 px L18)', () => {
    const m = thresholds.metrics;
    // PRD step 4a: ref tower crops are rescaled so the tower bbox is the M01 floor at 1366x768 wide: round(0.0245 x 1366) = 33 px.
    expect(REF_TOWER_WIDTH).toBe(Math.round(m.M01!.limits.min * 1366));
    expect(REF_TOWER_WIDTH).toBe(33);
    // L1 = min ref glyph across 31-35 px (tw01 5 @31, yt1 5 @34/35; 6/6 at 33); L18 = floor(5 x 10/12) = 4.
    expect(limitsFor(m.M16!, 'l01', '1366x768')).toEqual({ min: 5, px: true, atHeight: 768 });
    expect(limitsFor(m.M16!, 'l18', '1366x768')).toEqual({ min: 4, px: true, atHeight: 768 });
    expect(scaleLimit(limitsFor(m.M16!, 'l01', '1920x1080'), 1080, 1080).min).toBeCloseTo(7.031, 3);
  });
  it('M01, M02 and M16 are jointly satisfiable at the M01 floor for the ref digit ratio (0.164)', () => {
    const m = thresholds.metrics, ratio = 0.164;
    for (const [vw, vh] of [[1366, 768], [1920, 1080]] as const) {
      const towerW = m.M01!.limits.min * vw, glyph = ratio * towerW;
      expect(within(towerW / vw, limitsFor(m.M01!, 'l01', `${vw}x${vh}`))).toBe(true);
      expect(within(ratio, m.M02!.limits.ratio)).toBe(true);
      expect(glyph).toBeGreaterThanOrEqual(scaleLimit(limitsFor(m.M16!, 'l01', `${vw}x${vh}`), vh, 1080).min); // 5.49 >= 5; 7.71 >= 7.03
    }
  });
  it('px thresholds scale by viewport height', () => {
    expect(scaleLimit({ max: 12, px: true }, 768, 1080).max).toBeCloseTo(8.533, 3);
    expect(scaleLimit({ min: 12, px: true, atHeight: 768 }, 1080, 1080).min).toBeCloseTo(16.875, 3);
    expect(scaleLimit({ min: 0.5 }, 768)).toEqual({ min: 0.5 });
  });
});

describe('null never passes', () => {
  it('within() rejects null / NaN / undefined', () => {
    expect(within(null, { min: 0 })).toBe(false); expect(within(Number.NaN, {})).toBe(false); expect(within(undefined, { max: 1 })).toBe(false);
    expect(within(0.5, { min: 0.5, max: 0.5 })).toBe(true); expect(within(1, { eq: 1 })).toBe(true); expect(within(2, { eq: 1 })).toBe(false);
  });
  const tower = (over: object = {}) => ({ id: 't1', owner: 'p1', count: 10, cap: 50, floors: null, model: { x: 100, y: 100, w: 40, h: 60 }, countRect: null, countOnRoof: true, slotDots: 0, hasCard: false, paintHue: 212, visualWidthWorld: null, ...over });
  const probe = (over: object = {}) => ({ viewport: { w: 1000, h: 500 }, clearColor: '#000000', ground: { cornerRayHits: Array(9).fill(true), playQuadScreen: null }, towers: [tower()], lanes: [{ from: 't1', to: 't2', pair: 't1-t2', widthWorld: null, screenWidthPx: null, splitWorld: null, splitScreen: null, mid: { x: 0, y: 0 } }], troops: { count: 3, screenHeightPx: null, sampleRects: [] }, clash: { fxScreen: null, eventScreen: null, eventTick: null, eventPair: null }, ...over });
  const ctx = (id: string, p = probe(), extra: object = {}) => ({ entry: { frames: [] }, frame: { tick: 1, dom: { labels: 0, summary: 1, cards: [] } }, probe: p, def: thresholds.metrics[id], limits: limitsFor(thresholds.metrics[id]!, 'l01', '1920x1080'), scene: 'l01', viewport: '1920x1080', height: 1080, baseHeight: 1080, ...extra });
  it.each(['M04', 'M05', 'M06', 'M09', 'M10'])('%s fails on the v1 null probe fields', id => {
    expect(evaluate(id, ctx(id, probe(), { hsv: toHsv(image(4, 4, () => '#000000')) })).status).toBe('fail');
  });
  it('M03 fails when the DOM label count is missing or a card exists', () => {
    expect(evaluate('M03', ctx('M03')).status).toBe('pass');
    expect(evaluate('M03', { ...ctx('M03'), frame: { tick: 1 } }).status).toBe('fail');
    expect(evaluate('M03', ctx('M03', probe({ towers: [tower({ hasCard: true })] }))).status).toBe('fail');
  });
  it('M01: median owned tower width as a share of viewport width against the l01/l18 limits', () => {
    const w = (n: number) => tower({ model: { x: 0, y: 0, w: n, h: 90 } });
    const m01 = (towers: object[], viewport = { w: 1000, h: 562.5 }, scene = 'l01') =>
      evaluate('M01', { ...ctx('M01', probe({ viewport, towers })), limits: limitsFor(thresholds.metrics.M01!, scene, '1920x1080') });
    expect(m01([w(30)]).status).toBe('pass'); // 3% vw (5.3% vh)
    expect(m01([w(30)]).value).toBeCloseTo(0.03, 6);
    expect(m01([w(24)]).status).toBe('fail'); // 2.4% vw < 2.45%
    expect(m01([w(50)]).status).toBe('fail'); // 5% vw > 4.92%
    expect(m01([w(20), w(30), w(40)]).status).toBe('pass'); // median 30 -> 3%
    expect(m01([w(57.4)], { w: 1920, h: 1080 }).status).toBe('pass'); // v1 l01 5.3% vh = 2.98% vw
    expect(m01([w(43.2)], { w: 1920, h: 1080 }).status).toBe('fail'); // v1 l10 4.0% vh = 2.25% vw
    expect(m01([w(25)], { w: 1000, h: 562.5 }, 'l18').status).toBe('pass'); // 2.5% vw
    expect(m01([w(44.3)], { w: 1920, h: 1080 }, 'l18').status).toBe('fail'); // v1 l18 4.1% vh = 2.31% vw: no separate smaller l18 floor
    expect(m01([w(50)], { w: 1000, h: 562.5 }, 'l18').status).toBe('fail'); // 5% > 4.92%
    expect(evaluate('M01', ctx('M01', probe({ towers: [tower({ owner: null })] }))).status).toBe('fail'); // no owned tower -> null
  });
  it('M05: lane / tower width ratio 0.20-0.40 (refs 0.22-0.28 pass)', () => {
    const lane = (px: number | null) => ({ from: 't1', to: 't2', pair: 't1-t2', widthWorld: 1, screenWidthPx: px, splitWorld: null, splitScreen: null, mid: { x: 0, y: 0 } });
    const m05 = (...px: (number | null)[]) => evaluate('M05', ctx('M05', probe({ towers: [tower({ model: { x: 0, y: 0, w: 100, h: 90 } })], lanes: px.map(lane) })));
    expect(m05(22, 28).status).toBe('pass'); // yt1 range
    expect(m05(23, 26).status).toBe('pass'); // tw01 range
    expect(m05(19).status).toBe('fail'); expect(m05(41).status).toBe('fail');
    expect(m05(25, 19).status).toBe('fail'); // every lane must pass
    expect(m05(25, null).status).toBe('fail'); // null lane width never passes
  });
  it('a missing probe fails every probe metric', () => expect(evaluate('M08', { ...ctx('M08'), probe: null }).status).toBe('fail'));
  it('summarize: any fail -> fail, all info -> info, none -> missing', () => {
    const s = summarize([{ id: 'M01', scene: 'a', viewport: 'v', status: 'pass', value: 1, text: '' }, { id: 'M01', scene: 'b', viewport: 'v', status: 'fail', value: null, text: '' }, { id: 'M13', scene: 'a', viewport: 'v', status: 'info', value: 1, text: '' }]);
    expect(s.M01).toBe('fail'); expect(s.M13).toBe('info'); expect(s.M02).toBe('missing');
  });
});

describe('M13 perf (Decision 8)', () => {
  const perf = { fps: 5, frameMsP95: 1250, drawCalls: 50, jsMsP95: 4 };
  const job = (run: object, p: object = perf) => evaluateJob({ scene: 'l18', viewport: '1920x1080', entry: { frames: [{ label: null, settle: true, probe: null }], perf: p }, thresholds: { ...thresholds, metrics: { M13: thresholds.metrics.M13! } }, run, refs: [], pixels: async () => null });
  it('SwiftShader: fps is an informational row; portable proxies gate', async () => {
    const rows = await job({ gpu: false });
    expect(rows.map(r => r.status)).toEqual(['pass', 'info']);
    expect((await job({ gpu: false }, { ...perf, drawCalls: 109 }))[0]!.status).toBe('fail');
    expect(summarize(await job({ gpu: false })).M13).toBe('pass');
  });
  it('--gpu: fps gates (>=55)', async () => {
    const rows = await job({ gpu: true });
    expect(rows.map(r => r.status)).toEqual(['pass', 'fail']);
    expect((await job({ gpu: true }, { ...perf, fps: 60 })).map(r => r.status)).toEqual(['pass', 'pass']);
  });
  it('missing perf sample fails', async () => expect((await job({ gpu: false }, null as unknown as object)).every(r => r.status === 'fail')).toBe(true));
});

describe('M12 head-on (SP04 definition)', () => {
  const towers = [{ id: 'a', x: -40, z: 0, screen: { x: 100, y: 500 } }, { id: 'b', x: 40, z: 0, screen: { x: 900, y: 500 } }];
  const lane = (pair: string, splitScreen: { x: number; y: number } | null) => ({ from: 'a', to: 'b', pair, widthWorld: 1, screenWidthPx: 10, splitWorld: 1, splitScreen, mid: { x: 0, y: 0 } });
  const frame = (lanes: object[], tick = 120, eventScreen = { x: 500, y: 500 }) => ({ tick, sim: { towers, kinds: [{ id: 'k', speedPerTick: 20000 }] }, probe: { lanes, clash: { eventPair: 'a-b', eventTick: 100, eventScreen, fxScreen: null } } });
  const limits = thresholds.metrics.M12!.limits;
  const run = (main: ReturnType<typeof frame>, extra: ReturnType<typeof frame>[] = []) => headOn({ entry: { frames: [main, ...extra] }, frame: main, probe: main.probe, limits, height: 1080, baseHeight: 1080 });
  it('v1 shape (2 lanes for a-b, split null) fails', () => {
    const r = run(frame([lane('a-b', null), lane('a-b', null), lane('c-d', null)]));
    expect(r.pass).toBe(false); expect(r.value.pairLanes).toBe(2); expect(r.value.splitErrorPx).toBe(null);
  });
  it('one shared lane split on the Clash point passes; 13 px off fails', () => {
    const ok = [lane('a-b', { x: 505, y: 500 }), lane('c-d', null)];
    expect(run(frame(ok), [frame([lane('a-b', { x: 520, y: 500 }), lane('c-d', null)], 126)]).pass).toBe(true);
    expect(run(frame([lane('a-b', { x: 513, y: 500 }), lane('c-d', null)]), [frame(ok, 126)]).pass).toBe(false);
  });
  it('unsettled frames: 12 px + 2 x speed x k closure, beyond it fails', () => {
    // speed 1 world/tick, 10 px/world, k = 26 -> allowed 12 + 2*1*26*10 = 532 px
    const main = frame([lane('a-b', { x: 500, y: 500 }), lane('c-d', null)]);
    expect(run(main, [frame([lane('a-b', { x: 1000, y: 500 }), lane('c-d', null)], 126)]).pass).toBe(true);
    expect(run(main, [frame([lane('a-b', { x: 1040, y: 500 }), lane('c-d', null)], 126)]).pass).toBe(false);
  });
  it('no Clash event fails', () => {
    const f = frame([lane('a-b', { x: 500, y: 500 })]); f.probe.clash.eventPair = null as unknown as string;
    expect(run(f).pass).toBe(false);
  });
});

describe('pixel metrics', () => {
  it('M07 voidShare counts magenta pixels', () => expect(voidShare(image(10, 10, x => (x === 0 ? '#FF00FF' : '#202020')))).toBeCloseTo(0.1));
  it('M09/M10 use the play quad, not fixed bands: grass inside, sand/rock outside on any side', () => {
    // 20x10 frame, quad x 5..15 full height (landscape border at the sides)
    const img = toHsv(image(20, 10, x => (x >= 5 && x < 15 ? (x === 5 ? '#FFE1B3' : '#8CD62A') : x < 2 ? '#BC5439' : '#FFE1B3')));
    const mask = polygonMask(20, 10, [{ x: 5, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 10 }, { x: 5, y: 10 }]);
    const s = playQuadShares(img, mask);
    expect(s.grassInside).toBeCloseTo(0.9); expect(s.border).toEqual({ sandRock: 1, grass: 0, area: 0.5 });
  });
  it('M11 tower paint: Tower War look passes (b), whole-body team paint (City Takeover look) fails (b)', () => {
    const limits = thresholds.metrics.M11!.limits;
    // 10x20 tower: rows 0-5 blue roof, then alternating 3 white / 1 blue band; grass masked out
    const tw = toHsv(image(10, 20, (_x, y) => (y < 6 || (y - 6) % 4 === 3 ? '#2F7DE1' : '#F0F0F0')));
    const v = towerPaint(tw, { x: 0, y: 0, w: 10, h: 20 }, 'blue')!;
    expect(v.a).toBe(1); expect(v.b).toBeGreaterThanOrEqual(limits.b.min); expect(v.b).toBeLessThanOrEqual(limits.b.max);
    const ct = towerPaint(toHsv(image(10, 20, (_x, y) => (y % 5 === 0 ? '#F0F0F0' : '#2F7DE1'))), { x: 0, y: 0, w: 10, h: 20 }, 'blue')!;
    expect(ct.b).toBeGreaterThan(0.72);
    const grassOnly = towerPaint(toHsv(image(4, 4, () => '#8CD62A')), { x: 0, y: 0, w: 4, h: 4 }, 'blue');
    expect(grassOnly).toBe(null); // ground-masked -> no fg -> null (fails)
  });
  it('M16/M19 outlined digit: white fill with a dark ring is found, a plain white patch is not', () => {
    const ringed = toHsv(image(24, 14, (x, y) => (x >= 9 && x < 15 && y >= 2 && y < 12 ? '#FFFFFF' : x >= 7 && x < 17 && y >= 0 && y < 14 ? '#101010' : '#2F7DE1')));
    expect(outlinedDigit(ringed, { x: 0, y: 0, w: 24, h: 14 })?.h).toBe(10);
    const plain = toHsv(image(24, 14, (x, y) => (x >= 9 && x < 15 && y >= 2 && y < 12 ? '#FFFFFF' : '#2F7DE1')));
    expect(outlinedDigit(plain, { x: 0, y: 0, w: 24, h: 14 })).toBe(null);
  });
  it('M02/M16 glyph height = white fill plus its dark outline ring (calibrated on tw01 red5 / yt1 44)', () => {
    const ringed = toHsv(image(24, 14, (x, y) => (x >= 9 && x < 15 && y >= 2 && y < 12 ? '#FFFFFF' : x >= 7 && x < 17 && y >= 0 && y < 14 ? '#101010' : '#2F7DE1')));
    expect(outlinedDigit(ringed, { x: 0, y: 0, w: 24, h: 14 })?.glyphH).toBe(14);
    expect(digitHeight(ringed, { x: 0, y: 0, w: 24, h: 14 })).toBe(14);
  });
  it('M02 measures the same digit as M16: the tallest outlined glyph, not the glyph with the tallest white fill (yt1 "38" at 67 px)', () => {
    // A: fill 8 px + 2 px ring each side -> glyph 12 px. B: fill 9 px + 1 px ring -> glyph 11 px. Fill order alone picks B.
    const img = toHsv(image(40, 20, (x, y) => {
      if (x >= 8 && x < 14 && y >= 4 && y < 12) return '#FFFFFF';
      if (x >= 6 && x < 16 && y >= 2 && y < 14) return '#101010';
      if (x >= 24 && x < 30 && y >= 3 && y < 12) return '#FFFFFF';
      if (x >= 23 && x < 31 && y >= 2 && y < 13) return '#101010';
      return '#2F7DE1';
    }));
    const locator = { x: 0, y: 0, w: 40, h: 20 };
    expect(outlinedDigit(img, locator)?.glyphH).toBe(12);
    expect(digitHeight(img, locator)).toBe(12);
  });
  it('visual:calibrate rescales every ref tower crop to REF_TOWER_WIDTH before the size-dependent metrics', () => {
    const img = image(120, 120, () => '#8CD62A');
    const spec = { id: 'r', file: 'r.jpg', frame: { x: 0, y: 0, w: 120, h: 120 }, playQuad: { x: 0, y: 0, w: 120, h: 120 }, towers: [{ box: [10, 10, 60, 90], team: 'blue', count: 5, cap: 10, slots: 1 }] };
    const ref = prepareRef(spec, img);
    expect(ref.towers[0]!.scaled.width).toBe(REF_TOWER_WIDTH);
    expect(ref.towers[0]!.scaledRect).toEqual({ x: 0, y: 0, w: REF_TOWER_WIDTH, h: Math.round(80 * REF_TOWER_WIDTH / 50) });
  });
  it('M16/M19 JPEG-soft digit: light fill (V .85) with an outline only darker than the roof (V .62 on a V .95 roof) counts', () => {
    // yt1 "44": fill S<=.2 V .7-.9, outline dark blue V .6-.7, roof blue V ~.95 (no pixel reaches V<=.25).
    const soft = toHsv(image(32, 24, (x, y) => (x >= 13 && x < 19 && y >= 4 && y < 12 ? '#D8D8DC' : x >= 11 && x < 21 && y >= 2 && y < 14 ? '#2A5A9E' : '#3D8BF2')));
    const d = outlinedDigit(soft, { x: 0, y: 0, w: 32, h: 24 });
    expect(d?.h).toBe(8);
    expect(d?.glyphH).toBe(12);
  });
  it('M19 a bright slot dot on the roof (no darker ring) is not a digit, and is counted as a dot below the digit', () => {
    const roof = '#3D8BF2';
    const paint = (x: number, y: number) => {
      if (x >= 9 && x < 15 && y >= 3 && y < 11) return '#FFFFFF'; // digit fill
      if (x >= 7 && x < 17 && y >= 1 && y < 13) return '#14284A'; // outline
      if (y >= 16 && y < 20 && ((x >= 4 && x < 8) || (x >= 16 && x < 20))) return '#F4F6FA'; // two bright dots
      return roof;
    };
    const img = toHsv(image(24, 60, paint)), rect = { x: 0, y: 0, w: 24, h: 60 };
    const dotOnly = toHsv(image(24, 60, (x, y) => (y >= 16 && y < 20 && x >= 4 && x < 8 ? '#F4F6FA' : roof)));
    expect(outlinedDigit(dotOnly, { x: 0, y: 0, w: 24, h: 27 })).toBe(null);
    const digit = outlinedDigit(img, { x: 0, y: 0, w: 24, h: 27 });
    expect(digit?.glyphH).toBe(12);
    expect(slotDots(img, rect, digit, 'blue')).toBe(2);
  });
  it('M16/M19 white text on a dark DOM label card (v1) is not a roof digit: the plate around the glyph must be lit (V >= .45)', () => {
    const card = toHsv(image(32, 24, (x, y) => (x >= 13 && x < 19 && y >= 4 && y < 12 ? '#FFFFFF' : x >= 6 && x < 26 && y >= 0 && y < 18 ? '#141B2D' : '#9AA0A6')));
    expect(outlinedDigit(card, { x: 0, y: 0, w: 32, h: 24 })).toBe(null);
  });
  it('M19/M20 a white floor body with a dark slit inside the roof locator is not the digit, side highlights are not dots', () => {
    // yt1: the upper 45% of a 4-floor tower reaches the top floor body (white, 40+ px wide, dark slit window).
    const roof = '#3D8BF2';
    const paint = (x: number, y: number) => {
      if (x >= 21 && x < 27 && y >= 3 && y < 11) return '#FFFFFF'; // digit fill
      if (x >= 19 && x < 29 && y >= 1 && y < 13) return '#14284A'; // outline
      if (y >= 15 && y < 19 && x >= 22 && x < 26) return '#F4F6FA'; // one bright dot under the digit
      if (y >= 15 && y < 19 && x >= 43 && x < 47) return '#F4F6FA'; // white bevel highlight at the roof edge, off-centre
      if (x >= 4 && x < 44 && y >= 22 && y < 36) return y === 28 && x >= 10 && x < 38 ? '#202020' : '#F0F0F0'; // top floor body + slit
      return roof;
    };
    const img = toHsv(image(48, 80, paint)), rect = { x: 0, y: 0, w: 48, h: 80 };
    const digit = outlinedDigit(img, { x: 0, y: 0, w: 48, h: 36 });
    expect(digit?.x0).toBe(21);
    expect(slotDots(img, rect, digit, 'blue')).toBe(1);
  });
  it('M20 floor stripes count white runs between team bands', () => {
    const tw = toHsv(image(9, 22, (_x, y) => (y < 6 || y === 10 || y === 11 || y === 16 || y === 17 ? '#2F7DE1' : '#F0F0F0')));
    expect(floorStripes(tw, { x: 0, y: 0, w: 9, h: 22 }, 'blue')).toEqual({ whiteRuns: 2, bands: 2, teamRuns: 3 });
  });
  it('M16/M19 small towers (M01 floor, ~33 px): the digit is on the topmost glyph row, a ringed slot dot below it is not the digit', () => {
    const roof = '#3D8BF2', ring = '#14284A';
    const img = toHsv(image(24, 30, (x, y) => {
      if (x >= 9 && x < 15 && y >= 3 && y < 7) return '#FFFFFF'; // digit fill (4 rows), off-centre
      if (x >= 8 && x < 16 && y >= 2 && y < 8) return ring; // glyph 6 px
      if (x >= 10 && x < 14 && y >= 12 && y < 16) return '#FFFFFF'; // centred bright dot (4 rows)
      if (x >= 10 && x < 14 && (y === 10 || y === 17)) return ring; // blurred partial ring 2 px off the dot: glyph 8 px
      return roof;
    }));
    const d = outlinedDigit(img, { x: 0, y: 0, w: 24, h: 27 });
    expect(d?.y0).toBe(3); expect(d?.glyphH).toBe(6);
  });
  it('M16/M02 a digit fill cut in two by one dark pixel row is measured as one glyph (tw01 "5" at 38 px)', () => {
    const img = toHsv(image(24, 20, (x, y) => {
      if (x >= 9 && x < 13 && y >= 3 && y < 6) return '#FFFFFF'; // upper piece
      if ((x >= 13 && x < 15 && y >= 6 && y < 10) || (x >= 9 && x < 13 && y >= 7 && y < 10)) return '#FFFFFF'; // lower piece
      if (x >= 7 && x < 17 && y >= 1 && y < 12) return '#14284A'; // ring (and the dark cut at y 6)
      return '#3D8BF2';
    }));
    const locator = { x: 0, y: 0, w: 24, h: 20 };
    expect(outlinedDigit(img, locator)?.glyphH).toBe(11);
    expect(digitHeight(img, locator)).toBe(11);
  });
  it('M16/M19 a down-sampled soft ring (V .78 on a V .95 roof, contrast .17) still counts as the outline', () => {
    const soft = toHsv(image(32, 24, (x, y) => (x >= 13 && x < 19 && y >= 4 && y < 9 ? '#E8E8EC' : x >= 12 && x < 20 && y >= 3 && y < 10 ? '#5A8AC7' : '#3D8BF2')));
    expect(outlinedDigit(soft, { x: 0, y: 0, w: 32, h: 24 })?.glyphH).toBe(7);
  });
  it('M19 bright slot dots joined by roof-lighter blur pixels are counted one by one (yt1 "44" at 30-36 px)', () => {
    const img = toHsv(image(24, 60, (x, y) => {
      if (x >= 7 && x < 12 && y >= 3 && y < 11) return '#FFFFFF'; // digit fill
      if (x >= 5 && x < 14 && y >= 1 && y < 13) return '#14284A'; // outline
      if (y >= 16 && y < 19 && ((x >= 4 && x < 7) || (x >= 8 && x < 11) || (x >= 12 && x < 15))) return '#F4F6FA'; // 3 bright dots
      if (y >= 16 && y < 19 && (x === 7 || x === 11)) return '#7FB2F6'; // lighter, less saturated blur between them
      return '#3D8BF2';
    }));
    const digit = outlinedDigit(img, { x: 0, y: 0, w: 24, h: 27 });
    expect(digit?.glyphH).toBe(12);
    expect(slotDots(img, { x: 0, y: 0, w: 24, h: 60 }, digit, 'blue')).toBe(3);
  });
  it('M20 minimum stripe run scales with tower width: 1 px runs count on a 30 px tower, not on a 70 px one', () => {
    const paint = (_x: number, y: number) => (y === 6 || y === 9 ? '#F0F0F0' : '#2F7DE1');
    expect(floorStripes(toHsv(image(30, 20, paint)), { x: 0, y: 0, w: 30, h: 20 }, 'blue')).toEqual({ whiteRuns: 2, bands: 2, teamRuns: 3 });
    expect(floorStripes(toHsv(image(70, 20, paint)), { x: 0, y: 0, w: 70, h: 20 }, 'blue')).toEqual({ whiteRuns: 0, bands: 2, teamRuns: 3 });
  });
  it('M18 TV distance', () => {
    expect(tvDistance([0.5, 0.5, 0], [0.5, 0, 0.5])).toBeCloseTo(0.5); expect(tvDistance(null, [1])).toBe(null);
  });
});

describe('calibration (b): landscape mock (PRD Iteration protocol step 4b)', () => {
  // Landscape layout: grass play quad in the centre, sand border on every side (not only above/below as in the portrait refs).
  const quad = [{ x: 10, y: 8 }, { x: 90, y: 8 }, { x: 90, y: 52 }, { x: 10, y: 52 }];
  const inQuad = (x: number, y: number) => x >= 10 && x < 90 && y >= 8 && y < 52;
  // quad: grass with a white "tower" block (grass .83 inside the quad, .49 of the frame)
  const landscape = (side: string) => toHsv(image(100, 60, (x, y) => (inQuad(x, y) ? (x >= 40 && x < 60 && y >= 15 && y < 45 ? '#F0F0F0' : '#8CD62A') : y < 8 || y >= 52 ? '#F5DEB3' : side)));
  it('M09/M10/M14 pass when the border is sand on the top, bottom and sides', () => {
    const rows = calibrateMock(landscape('#F5DEB3'), quad, thresholds, 'mock');
    expect(rows.map(r => `${r.id}:${r.status}`)).toEqual(['M09:pass', 'M10:pass', 'M14:pass']);
    expect(rows[0]!.scene).toBe('mock');
  });
  it('M10 fails when the side border is grass (region logic must look at every side outside the quad)', () => {
    const rows = calibrateMock(landscape('#8CD62A'), quad, thresholds, 'mock');
    expect(rows.find(r => r.id === 'M10')!.status).toBe('fail');
  });
});
