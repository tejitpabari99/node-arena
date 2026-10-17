import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import type { TestApi } from '../src/test-harness';
declare global { interface Window { __na?: TestApi } }

/**
 * Owner-run slice verification (SP05 Task 10, Acceptance 7). Opt-in: skipped unless SLICE=1 (see `pnpm slice:verify`).
 * 1920x1080, SHIPPED manifest (real art), L1/L10/L18 x {default, colourblind}.
 * Output (not committed): SLICE_OUT or apps/web/test-results/slice/.
 */
const enabled = process.env.SLICE === '1';
const OUT = path.resolve(process.env.SLICE_OUT ?? 'test-results/slice');
const LEVELS_DIR = path.resolve(process.cwd(), '../../packages/content/data/levels');
const LEVELS = ['01-first-steps', '10-two-foes', '18-free-for-all'] as const;
const PALETTES = ['default', 'colorblind'] as const;
const MIN_CHIP_PX = 14;
const RUN_MS = Number(process.env.SLICE_RUN_MS ?? 4000);
const PERF_MS = Number(process.env.SLICE_PERF_MS ?? 10000);

test.describe('slice verification (owner-run, SLICE=1)', () => {
  test.skip(!enabled, 'opt-in: set SLICE=1 (pnpm slice:verify)');
  test.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  test.setTimeout(180000);
  test.beforeAll(() => { fs.mkdirSync(OUT, { recursive: true }); });

  async function open(page: Page, level: string, palette: typeof PALETTES[number]) {
    await page.goto('/?test=1'); // no fixture: shipped content + shipped manifest (no route override)
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await page.evaluate(p => window.__na!.settings({ quality: 'high', reducedMotion: false, colorblind: p === 'colorblind' }), palette);
    await page.evaluate(id => window.__na!.load(id), level);
    await expect(page.locator('main')).toHaveAttribute('data-screen', 'playing');
    await expect(page.locator('[data-tower-index]').first()).toBeVisible();
  }

  for (const level of LEVELS) for (const palette of PALETTES) test(`${level} ${palette}: screenshot, label chips, seat distinctness`, async ({ page }) => {
    await open(page, level, palette);
    const seats = (JSON.parse(fs.readFileSync(path.join(LEVELS_DIR, `${level}.json`), 'utf8')).players as unknown[]).length;
    await page.waitForTimeout(RUN_MS); // real-time run so troops/lines/labels are in a lived-in state
    const chips = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-tower-index]')].filter(e => e.style.display !== 'none').map(e => {
      const box = e.getBoundingClientRect();
      const rows = [...e.querySelectorAll<HTMLElement>('[data-component]')].map(r => ({ key: r.dataset.component!, text: r.textContent ?? '', fontPx: parseFloat(getComputedStyle(r).fontSize), height: r.getBoundingClientRect().height }));
      return { index: e.dataset.towerIndex!, color: e.dataset.teamColor ?? '', marker: e.querySelector('[data-team-marker]')?.textContent ?? '', width: box.width, height: box.height, fontPx: parseFloat(getComputedStyle(e).fontSize), rows };
    }));
    const file = `${level}.${palette}`;
    await page.screenshot({ path: path.join(OUT, `${file}.png`) });

    // Count-label chips: whole chip and its count text must be >= 14 px.
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect.soft(chip.height, `chip ${chip.index} height`).toBeGreaterThanOrEqual(MIN_CHIP_PX);
      expect.soft(chip.fontPx, `chip ${chip.index} font px`).toBeGreaterThanOrEqual(MIN_CHIP_PX);
      for (const row of chip.rows) expect.soft(row.fontPx, `chip ${chip.index} ${row.key} font px`).toBeGreaterThanOrEqual(MIN_CHIP_PX);
    }
    // Seat distinctness: one colour <-> one marker; distinct colours have distinct markers; every seat is represented.
    const byColor = new Map<string, Set<string>>();
    for (const c of chips) { if (!byColor.has(c.color)) byColor.set(c.color, new Set()); byColor.get(c.color)!.add(c.marker); }
    for (const [color, markers] of byColor) expect.soft(markers.size, `colour ${color} uses one marker`).toBe(1);
    const markers = [...byColor.values()].map(s => [...s][0]);
    expect.soft(new Set(markers).size, 'markers distinct per colour').toBe(markers.length);
    expect.soft(byColor.size, `>= ${seats} distinct seat colours (neutral may add one)`).toBeGreaterThanOrEqual(seats);
    const report = { level, palette, viewport: '1920x1080', seats, minChipHeight: Math.min(...chips.map(c => c.height)), minFontPx: Math.min(...chips.flatMap(c => [c.fontPx, ...c.rows.map(r => r.fontPx)])), colors: Object.fromEntries([...byColor].map(([k, v]) => [k, [...v][0]])), chips };
    fs.writeFileSync(path.join(OUT, `${file}.labels.json`), JSON.stringify(report, null, 2));
    await test.info().attach(`${file}.labels.json`, { body: JSON.stringify(report), contentType: 'application/json' });
  });

  for (const palette of PALETTES) test(`18-free-for-all ${palette}: perf HUD and frame-time stats`, async ({ page }) => {
    await open(page, '18-free-for-all', palette);
    // Let bots build up traffic, then show the SP03 perf HUD.
    await page.waitForTimeout(RUN_MS);
    const toggle = page.getByRole('button', { name: 'Performance', exact: true });
    if (await toggle.count()) await toggle.click();
    const hud = page.getByLabel('Performance metrics');
    await expect(hud).toBeVisible();
    const frames = await page.evaluate(ms => new Promise<number[]>(resolve => {
      const deltas: number[] = []; let prev = performance.now(); const end = prev + ms;
      const tick = (t: number) => { deltas.push(t - prev); prev = t; if (t < end) requestAnimationFrame(tick); else resolve(deltas); };
      requestAnimationFrame(tick);
    }), PERF_MS);
    const hudText = (await hud.innerText()).replace(/\s+/g, ' ').trim();
    await page.screenshot({ path: path.join(OUT, `18-free-for-all.${palette}.perf.png`) });
    const sorted = frames.slice(1).sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]!;
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const stats = {
      level: '18-free-for-all', palette, viewport: '1920x1080', durationMs: PERF_MS, frames: sorted.length,
      fpsMean: 1000 / mean, frameMs: { p50: q(.5), p95: q(.95), p99: q(.99), max: sorted[sorted.length - 1] },
      hud: hudText, hudRaw: await page.evaluate(() => (window.__na as any)?.memory?.() ?? null),
      note: 'Headless Chromium with SwiftShader unless run headed with a real GPU; owner judges 60 fps on the laptop GPU.',
    };
    fs.writeFileSync(path.join(OUT, `18-free-for-all.${palette}.perf.json`), JSON.stringify(stats, null, 2));
    await test.info().attach('perf.json', { body: JSON.stringify(stats), contentType: 'application/json' });
    expect(sorted.length).toBeGreaterThan(30); // recorded evidence; fps threshold is the owner's call
  });
});
