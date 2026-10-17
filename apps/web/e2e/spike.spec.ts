import { expect, test } from '@playwright/test';

for (const mode of ['bob', 'static-bob', 'none']) {
  test(`troop spike measures ${mode} in software GL`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`/spike.html?mode=${mode}`);
    await page.waitForFunction(() => '__troopSpike' in window, { timeout: 150_000 });
    const report = await page.evaluate(() => (window as unknown as { __troopSpike: {
      mode: string; environment: { troopCount: number; buckets: number; trianglesPerTroop: number; renderer: string };
      jsMs: { samples: number; p95: number }; frameMs: { samples: number }; drawCalls: number; triangles: number; fps: number;
    } }).__troopSpike);
    console.log(`SPIKE_RESULT ${JSON.stringify(report)}`);
    expect(errors).toEqual([]);
    expect(report.environment.renderer).toContain('SwiftShader');
    expect(report.environment.troopCount).toBe(2000);
    expect(report.environment.buckets).toBe(4);
    expect(report.environment.trianglesPerTroop).toBeLessThanOrEqual(300);
    expect(report.jsMs.samples).toBe(120);
    expect(report.frameMs.samples).toBe(119);
    expect(report.drawCalls).toBe(4);
    expect(report.triangles).toBe(2000 * report.environment.trianglesPerTroop);
    expect(report.fps).toBeGreaterThan(0);
    // CPU update/submission gate; software rasterization fps is deliberately not a laptop gate.
    expect(report.jsMs.p95).toBeLessThan(4);
  });
}
