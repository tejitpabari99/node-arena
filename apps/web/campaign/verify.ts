import { expect, type ConsoleMessage, type Page } from '@playwright/test';
import { TICK_RATE } from '@node-arena/sim';

/** Exercise the real authored level, bots and renderer; test mode needs explicit steps. */
export async function verifyLevel(page: Page, levelId: string) {
  const errors: string[] = [];
  const onConsole = (message: ConsoleMessage) => { if (message.type() === 'error') errors.push(`console.error: ${message.text()}`); };
  const onPageError = (error: Error) => { errors.push(`pageerror: ${error.message}`); };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  try {
    await page.goto(`/?test=1&level=${encodeURIComponent(levelId)}`);
    await expect.poll(() => page.evaluate(() => window.__na?.screen), { timeout: 20000 }).toBe('playing');
    expect(await page.evaluate(() => window.__na!.state().levelId)).toBe(levelId);
    await expect(page.locator('#arena canvas')).toBeVisible();
    const initialTick = await page.evaluate(() => window.__na!.view!.tick);
    for (let second = 0; second < 5; second++) {
      await page.evaluate(ticks => window.__na!.step(ticks), TICK_RATE);
      await page.waitForTimeout(1000);
    }
    const rendered = await page.evaluate(() => {
      window.__na!.render();
      return { tick: window.__na!.view!.tick, info: window.__na!.renderInfo(), state: window.__na!.state() };
    });
    expect(rendered.state.levelId).toBe(levelId);
    expect(rendered.state.error).toBeNull();
    expect(rendered.tick - initialTick).toBe(5 * TICK_RATE);
    expect(rendered.info?.triangles).toBeGreaterThan(0);
    const screenshot = await page.screenshot();
    if (errors.length) throw new Error(`${levelId}: ${errors.join('\n')}`);
    return { levelId, tick: rendered.tick, triangles: rendered.info!.triangles, screenshot };
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
}
