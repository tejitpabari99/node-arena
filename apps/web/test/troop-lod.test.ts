import { expect, it } from 'vitest';
import { LOD_HIGH_COUNT, LOD_HIGH_EMA_MS, LOD_LOW_COUNT, LOD_LOW_EMA_MS, createLodPolicy, parseLodMode } from '../src/render/troop-lod.js';
/** Fake clock: `run(seconds, frameMs, live)` feeds frames and returns the elapsed time at which the state first changed (or null). */
function harness(initial: 'high' | 'low' = 'high', overrides = {}) {
  const p = createLodPolicy(overrides, initial); let t = 100;
  p.update(0, t);
  return { p, now: () => t, run(seconds: number, frameMs: number, live: number) {
    const start = t, before = p.state; let flipped: number | null = null;
    while (t - start < seconds - 1e-9) { t += frameMs / 1000; if (p.update(live, t) !== before && flipped === null) flipped = t - start; }
    return flipped;
  } };
}
it('constants match the PRD', () => { expect([LOD_LOW_COUNT, LOD_HIGH_COUNT, LOD_LOW_EMA_MS, LOD_HIGH_EMA_MS]).toEqual([600, 400, 20, 14]); });
it('high -> low once live > 600 (strict, immediate) and not at exactly 600', () => {
  const h = harness(); expect(h.run(2, 10, 600)).toBeNull(); expect(h.p.state).toBe('high');
  expect(h.run(.05, 10, 601)).not.toBeNull(); expect(h.p.state).toBe('low');
});
it('high -> low only after EMA > 20 ms is sustained for 1 s', () => {
  const h = harness(); expect(h.run(.9, 25, 50)).toBeNull(); expect(h.p.state).toBe('high');
  const at = h.run(.3, 25, 50); expect(at).not.toBeNull(); expect(h.p.state).toBe('low');
  expect(at!).toBeGreaterThanOrEqual(.1 - 1e-6); // total sustained time >= 1 s
});
it('a short slow spell (< 1 s) never flips, and the hold restarts after a recovery', () => {
  const h = harness(); for (let i = 0; i < 5; i++) { expect(h.run(.6, 40, 50)).toBeNull(); expect(h.run(2, 8, 50)).toBeNull(); } expect(h.p.state).toBe('high');
});
it('low -> high needs live < 400 AND EMA < 14 ms for 3 s; EMA 14..20 ms or live 400..600 stays low', () => {
  let h = harness('low'); expect(h.run(10, 16, 100)).toBeNull(); expect(h.p.state).toBe('low'); // 16 ms: inside the band
  h = harness('low'); expect(h.run(10, 8, 400)).toBeNull(); expect(h.run(10, 8, 550)).toBeNull(); expect(h.p.state).toBe('low'); // live not < 400
  h = harness('low'); expect(h.run(3.3, 8, 399)).not.toBeNull(); expect(h.p.state).toBe('high');
  h = harness('low'); expect(h.run(2.9, 8, 399)).toBeNull(); expect(h.p.state).toBe('low');
});
it('interrupting the 3 s hold (live back to 450) restarts it', () => {
  const h = harness('low'); h.run(2.5, 8, 300); h.run(.1, 8, 450); expect(h.run(2.9, 8, 300)).toBeNull(); expect(h.p.state).toBe('low'); expect(h.run(.4, 8, 300)).not.toBeNull(); expect(h.p.state).toBe('high');
});
it('no flapping when frame time oscillates around the thresholds', () => {
  const h = harness(); let flips = 0, last = h.p.state;
  for (let i = 0; i < 6000; i++) { h.run(.01, i % 2 ? 12 : 28, 100); if (h.p.state !== last) { flips++; last = h.p.state; } } // EMA ~ 20 ms: noise around the up threshold
  expect(flips).toBeLessThanOrEqual(2);
  const g = harness('low'); let f2 = 0, l2 = g.p.state;
  for (let i = 0; i < 6000; i++) { g.run(.01, i % 2 ? 6 : 22, 100); if (g.p.state !== l2) { f2++; l2 = g.p.state; } } // EMA ~ 14 ms around the down threshold
  expect(f2).toBeLessThanOrEqual(2);
});
it('a long gap (hidden tab) is not counted as slow frames; threshold overrides apply', () => {
  const h = harness(); h.p.update(10, h.now() + 30); expect(h.p.state).toBe('high');
  const o = createLodPolicy({ lowCount: 100 }); o.update(101, 1); expect(o.state).toBe('low');
});
it('parseLodMode accepts low/high and falls back to auto', () => { expect([parseLodMode('low'), parseLodMode('high'), parseLodMode('x'), parseLodMode(null)]).toEqual(['low', 'high', 'auto', 'auto']); });
