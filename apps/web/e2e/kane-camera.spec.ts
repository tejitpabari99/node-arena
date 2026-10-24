import { expect, test } from '@playwright/test';
import path from 'node:path';

const evidence = path.resolve(import.meta.dirname, '../../../docs/agent_files/feat-kane-hackday-20261023-2128/02-play-controls/evidence');

test('Kane map, buildings and tags clear the shared panel height after viewport resize', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/?kane=1');
  await expect(page.getByTestId('kane-tag')).toHaveCount(5);
  await expect.poll(() => page.evaluate(() => window.__na!.view!.tick)).toBeGreaterThan(0);
  for (const size of [{ width: 1600, height: 900, panel: 198 }, { width: 1366, height: 768, panel: 168.96 }]) {
    await page.setViewportSize(size);
    await expect.poll(() => page.getByTestId('kane-panel').evaluate(element => element.getBoundingClientRect().height)).toBeCloseTo(size.panel, 1);
    // Wait for the camera's ResizeObserver and the tag layer's frame refresh.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const panel = await page.getByTestId('kane-panel').boundingBox();
    expect(panel).not.toBeNull();
    const probe = await page.evaluate(() => window.__na!.visualProbe());
    expect(probe.mapRect).not.toBeNull();
    const rects = [probe.mapRect, ...probe.buildings.flatMap(building => [building.modelRect, building.labelRect])];
    for (const rect of rects) {
      expect(rect).not.toBeNull();
      expect(rect!.y).toBeGreaterThanOrEqual(104);
      expect(rect!.y + rect!.h).toBeLessThan(panel!.y - 12);
      expect(rect!.x).toBeGreaterThanOrEqual(36);
      expect(rect!.x + rect!.w).toBeLessThanOrEqual(size.width - 36);
    }
    const tags = await page.getByTestId('kane-tag').evaluateAll(elements => elements.map(element => {
      const r = element.getBoundingClientRect(); return { top: r.top, bottom: r.bottom };
    }));
    expect(tags.every(tag => tag.top >= 104 && tag.bottom < panel!.y - 12)).toBe(true);
    await page.screenshot({ path: path.join(evidence, `task6-kane-${size.width}x${size.height}.png`) });
  }
});
