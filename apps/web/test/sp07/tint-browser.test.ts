import { expect, it } from 'vitest';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

type Px = { masked: number[]; unmasked: number[] };
/** Renders a synthetic base + half-white/half-black mask through the real tintMask material in headless WebGL. */
it('tintMask: masked region takes the palette tint, unmasked region stays base (covers R7 tintMask contract)', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'tint-fixture', configureServer(s) { s.middlewares.use('/__tint', async (_q, res) => { res.setHeader('Content-Type', 'text/html'); res.end(await s.transformIndexHtml('/__tint', '<!doctype html><html><body><script type="module" src="/test/sp07/tint-fixture.ts"></script></body></html>')); }); } }] });
  await server.listen(); const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage(), errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(server.resolvedUrls!.local[0] + '__tint'); await page.waitForFunction(() => 'tintRun' in window);
    const r = await page.evaluate(() => (window as any).tintRun()) as Record<string, any>;
    expect(errors).toEqual([]);
    expect(r.keys).toEqual(['blue', 'green', 'red', 'yellow', 'gray']);
    const enc = (l: number) => Math.round(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055));
    for (const team of r.keys as string[]) {
      const t = r[team] as Px & { tint: number[]; same: boolean };
      expect(t.same).toBe(true); // one cached material per (family, team)
      expect(t.unmasked).toEqual(r.plain.unmasked); // unmasked == untinted base
      const want = (r.base as number[]).map((b, i) => enc(b * t.tint[i]!));
      t.masked.forEach((v, i) => expect(Math.abs(v - want[i]!), `${team} ch${i}: got ${t.masked} want ${want}`).toBeLessThanOrEqual(3));
    }
    expect(r.red.masked[0]).toBeGreaterThan(r.red.masked[2]); expect(r.blue.masked[2]).toBeGreaterThan(r.blue.masked[0]);
    expect(r.red.masked).not.toEqual(r.blue.masked);
  } finally { await browser.close(); await server.close(); }
}, 60000);
