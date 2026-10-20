import { describe, expect, it } from 'vitest';
import { checkConsistency, loadChecklist } from '../visual/lib/checklist.mjs';
import { collectHud, contrast, evaluateHudJob, HUD_IDS, HUD_SELECTORS, parseCssColor, resolveBackground, summarizeHud } from '../visual/lib/hud-metrics.mjs';
import { loadThresholds } from '../visual/lib/metrics.mjs';
import { contrastRatio, HUD_TOKENS } from '../src/ui/tokens';

const th = loadThresholds();
const vp = { w: 1920, h: 1080 };
/** A compliant HUD record at 1920x1080. */
const good = () => ({
  viewport: vp, root: { x: 0, y: 0, w: 1920, h: 1080 }, pill: { x: 760, y: 12, w: 400, h: 56 },
  colors: { fg: 'rgb(255, 255, 255)', bgChain: ['rgb(27, 91, 192)', 'rgba(0, 0, 0, 0)'] },
  meter: { rect: { x: 780, y: 48, w: 360, h: 10 }, role: 'meter', valueText: 'Blue 60%, Red 40%', segments: [{ team: 'p1', x: 780, y: 48, w: 216, h: 10 }, { team: 'b1', x: 996, y: 48, w: 144, h: 10 }] },
  buttons: { pause: { x: 16, y: 16, w: 48, h: 48 }, speed: { x: 1856, y: 16, w: 48, h: 48 } },
  tip: false, helpBars: 0, area: 400 * 56 + 2 * 48 * 48, legacyBar: null, expected: [{ team: 'p1', pct: 60 }, { team: 'b1', pct: 40 }],
});
const job = (hud: unknown, scene = 'l01', viewport = '1920x1080') => evaluateHudJob({ scene, viewport, entry: { frames: [{ label: null, settle: true, hud }] }, thresholds: th });
const status = (rows: ReturnType<typeof job>) => Object.fromEntries(rows.map(r => [r.id, r.status]));

describe('H01-H07 thresholds', () => {
  it('are in thresholds.json and agree with CHECKLIST Appendix B / B.1', () => {
    for (const id of HUD_IDS) expect(th.metrics[id], id).toBeDefined();
    expect(checkConsistency(loadChecklist(), th)).toEqual([]);
    expect(th.metrics.H03!.limits).toEqual({ size: { min: 44, max: 64 } });
    expect(th.metrics.H06!.limits).toEqual({ sumPx: { max: 1 }, shareErr: { max: 0.02 } });
  });
});

describe('evaluateHudJob', () => {
  it('passes a compliant HUD on every scene x viewport it applies to', () => {
    const rows = job(good());
    expect(rows.map(r => r.id)).toEqual(HUD_IDS);
    expect(status(rows)).toEqual(Object.fromEntries(HUD_IDS.map(id => [id, 'pass'])));
    expect(job(good(), 'l01-tip', '1366x768')).toHaveLength(7);
    expect(job(good(), 'menu')).toEqual([]);
    expect(job(good(), 'l18', '1920x1200')).toEqual([]);
  });
  it('fails every metric on a pre-HUD record (null never passes), and H05 sees the v1 help bar', () => {
    const pre = { viewport: vp, root: null, pill: null, colors: null, meter: null, buttons: { pause: null, speed: null }, tip: false, helpBars: 1, area: null, legacyBar: { x: 0, y: 0, w: 1920, h: 40 }, expected: null };
    expect(Object.values(status(job(pre)))).toEqual(Array(7).fill('fail'));
    expect(Object.values(status(job(null)))).toEqual(Array(7).fill('fail'));
    expect(summarizeHud(job(pre)).H05).toBe('fail');
    expect(summarizeHud([]).H01).toBe('missing');
  });
  it('H01/H02: off-centre or low pill', () => {
    const a = good(); a.pill = { x: 800, y: 12, w: 400, h: 56 }; expect(status(job(a)).H01).toBe('fail'); // centre 1000 vs 960 = 2.08%
    const b = good(); b.pill = { x: 760, y: 50, w: 400, h: 56 }; expect(status(job(b)).H02).toBe('fail'); // 4.6%
    const c = good(); c.pill = { x: 770, y: 43, w: 400, h: 56 }; expect(status(job(c))).toMatchObject({ H01: 'pass', H02: 'pass' }); // 1.04%, 3.98%
  });
  it('H03: buttons 44..64 px', () => {
    const a = good(); a.buttons.pause = { x: 0, y: 0, w: 40, h: 40 }; expect(status(job(a)).H03).toBe('fail');
    const b = good(); b.buttons.speed = { x: 0, y: 0, w: 70, h: 70 }; expect(status(job(b)).H03).toBe('fail');
    const c = good(); c.buttons.speed = { x: 0, y: 0, w: 44, h: 64 }; expect(status(job(c)).H03).toBe('pass');
    const d = good(); d.buttons.speed = null as never; expect(status(job(d)).H03).toBe('fail');
  });
  it('H04: area share and H05: help bar count', () => {
    const a = good(); a.area = 1920 * 1080 * 0.13; expect(status(job(a)).H04).toBe('fail');
    const b = good(); b.area = 1920 * 1080 * 0.12; expect(status(job(b)).H04).toBe('pass');
    const c = good(); c.helpBars = 1; expect(status(job(c)).H05).toBe('fail');
  });
  it('H06: widths sum within 1 px and shares within 2% of strength()', () => {
    const a = good(); a.meter.segments[1]!.w = 142; expect(status(job(a)).H06).toBe('fail'); // sum off 2 px
    const b = good(); b.meter.segments = [{ team: 'p1', x: 0, y: 0, w: 252 }, { team: 'b1', x: 0, y: 0, w: 108 }] as never; expect(status(job(b)).H06).toBe('fail'); // 70/30 vs 60/40
    const c = good(); c.meter.segments[0]!.w = 216.5; c.meter.segments[1]!.w = 143.5; expect(status(job(c)).H06).toBe('pass');
    const d = good(); d.expected = null as never; expect(status(job(d)).H06).toBe('fail');
    const e = good(); e.meter.segments[1]!.team = 'zz'; expect(status(job(e)).H06).toBe('fail');
  });
  it('H07: contrast of pill text >= 4.5', () => {
    const a = good(); a.colors = { fg: 'rgb(255, 255, 255)', bgChain: ['rgb(46, 139, 255)'] }; expect(status(job(a)).H07).toBe('fail'); // HUD blue #2E8BFF vs white ~3.4
    const b = good(); b.colors = { fg: 'rgb(255, 255, 255)', bgChain: ['rgba(0, 0, 0, 0)', 'rgb(27, 91, 192)'] }; expect(status(job(b)).H07).toBe('pass');
  });
});

describe('colour helpers', () => {
  it('match src/ui/tokens.ts contrastRatio', () => {
    const hex = (h: string) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });
    for (const [a, b] of [[HUD_TOKENS.pillText, HUD_TOKENS.pillBg], [HUD_TOKENS.blue, '#FFFFFF'], ['#000000', '#FFFFFF']] as const) expect(contrast(hex(a), hex(b))).toBeCloseTo(contrastRatio(a, b), 6);
    expect(contrast(hex(HUD_TOKENS.pillText), hex(HUD_TOKENS.pillBg))).toBeGreaterThanOrEqual(4.5);
  });
  it('parses css colours and composites translucent layers over white', () => {
    expect(parseCssColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseCssColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseCssColor('nope')).toBeNull();
    expect(resolveBackground(['rgba(0, 0, 0, 0.5)', 'rgb(255, 255, 255)'])).toEqual({ r: 127.5, g: 127.5, b: 127.5 });
    expect(resolveBackground(['rgba(0, 0, 0, 0)'])).toEqual({ r: 255, g: 255, b: 255 });
    expect(resolveBackground(['linear-gradient'])).toBeNull();
  });
});

describe('collectHud', () => {
  it('is self-contained (serialisable for page.evaluate) and reads the documented selectors', () => {
    const src = collectHud.toString();
    expect(src).not.toMatch(/\bimport\b|HUD_SELECTORS|parseCssColor/);
    expect(Object.keys(HUD_SELECTORS)).toEqual(['root', 'pill', 'meter', 'seg', 'pause', 'speed', 'tip', 'helpBar', 'legacyBar']);
    expect(HUD_SELECTORS.pill).toBe('[data-hud="pill"]');
    expect(HUD_SELECTORS.seg).toBe('[data-hud-seg]');
  });
});
