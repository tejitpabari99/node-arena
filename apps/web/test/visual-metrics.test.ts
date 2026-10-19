import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isGrass, isGrey, isMagenta, isRock, isSand, isTeamSat, isWhite, nearestTeam, rgbToHsv } from '../visual/lib/color.mjs';
import { evaluate, evaluateJob, headOn, limitsFor, loadThresholds, METRIC_IDS, scaleLimit, summarize, within } from '../visual/lib/metrics.mjs';
import { floorStripes, outlinedDigit, playQuadShares, polygonMask, toHsv, towerPaint, tvDistance, voidShare } from '../visual/lib/pixel-metrics.mjs';

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
    expect(limitsFor(m.M01!, 'l01', '1920x1080')).toEqual({ min: 0.06, max: 0.12 });
    expect(limitsFor(m.M01!, 'l10', '1366x768')).toEqual({ min: 0.055, max: 0.12 });
    expect(limitsFor(m.M01!, 'l18', '1920x1080')).toEqual({ min: 0.03, max: 0.08 });
    expect(m.M02!.limits.ratio).toEqual({ min: 0.14, max: 0.30 });
    expect(m.M05!.limits.ratio).toEqual({ min: 0.25, max: 0.40 });
    expect(m.M06!.limits).toEqual({ heightShare: { min: 0.015 }, perTowerWidth: { min: 0.22, max: 0.60 } });
    expect(m.M07!.limits.share).toEqual({ max: 0.005 }); expect(m.M07!.viewports).toContain('1920x1200');
    expect(m.M08!.viewports).toContain('1920x1200');
    expect(m.M10!.limits).toEqual({ sandRock: { min: 0.60 }, grass: { max: 0.05 }, area: { min: 0.10 } });
    expect(m.M11!.limits).toEqual({ a: { min: 0.85 }, b: { min: 0.35, max: 0.72 }, c: { min: 0.15, max: 0.45 }, neutralSat: { max: 0.05 }, neutralGreyWhite: { min: 0.90 } });
    expect(m.M12!.limits.splitErrorPx).toEqual({ max: 12, px: true });
    expect(m.M14!.limits.share).toEqual({ min: 0.30, max: 0.60 });
    expect(m.M15!.limits).toEqual({ minMargin: { min: 0.02 }, unionMargin: { max: 0.10 } });
    expect(m.M18!.limits).toEqual({ frame: { max: 0.20 }, tower: { max: 0.20 } });
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
  it('M01: median owned tower width share against the l01 limits', () => {
    expect(evaluate('M01', ctx('M01', probe({ towers: [tower({ model: { x: 0, y: 0, w: 70, h: 90 } })] }))).status).toBe('pass'); // 7%
    expect(evaluate('M01', ctx('M01')).status).toBe('fail'); // 4%
    expect(evaluate('M01', ctx('M01', probe({ towers: [tower({ owner: null })] }))).status).toBe('fail'); // no owned tower -> null
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
    const ringed = toHsv(image(12, 14, (x, y) => (x >= 3 && x < 9 && y >= 2 && y < 12 ? '#FFFFFF' : x >= 1 && x < 11 && y >= 0 && y < 14 ? '#101010' : '#2F7DE1')));
    expect(outlinedDigit(ringed, { x: 0, y: 0, w: 12, h: 14 })?.h).toBe(10);
    const plain = toHsv(image(12, 14, (x, y) => (x >= 3 && x < 9 && y >= 2 && y < 12 ? '#FFFFFF' : '#2F7DE1')));
    expect(outlinedDigit(plain, { x: 0, y: 0, w: 12, h: 14 })).toBe(null);
  });
  it('M20 floor stripes count white runs between team bands', () => {
    const tw = toHsv(image(9, 22, (_x, y) => (y < 6 || y === 10 || y === 11 || y === 16 || y === 17 ? '#2F7DE1' : '#F0F0F0')));
    expect(floorStripes(tw, { x: 0, y: 0, w: 9, h: 22 }, 'blue')).toEqual({ whiteRuns: 2, bands: 2, teamRuns: 3 });
  });
  it('M18 TV distance', () => {
    expect(tvDistance([0.5, 0.5, 0], [0.5, 0, 0.5])).toBeCloseTo(0.5); expect(tvDistance(null, [1])).toBe(null);
  });
});
