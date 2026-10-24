import { expect, test } from '@playwright/test';
import { openLevel } from './helpers';

test('Kane shell cycles speed, reports phase, and retains speed across restart', async ({ page }) => {
  await page.goto('/?kane=1');
  const overlay = page.getByTestId('kane-overlay'), speed = page.getByTestId('kane-speed');
  await expect(overlay).toHaveAttribute('data-phase', 'playing');
  for (const value of ['0.25', '0.5', '1', '2', '0.25']) {
    await expect(overlay).toHaveAttribute('data-speed', value);
    await expect(speed).toHaveText(`Speed ${value}x`);
    await expect(speed).toHaveAttribute('data-speed', value);
    await speed.click();
  }
  await expect(speed).toHaveText('Speed 0.5x');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(overlay).toHaveAttribute('data-phase', 'paused');
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(overlay).toHaveAttribute('data-phase', 'playing');
  await expect(speed).toHaveText('Speed 0.5x');
  expect(await page.evaluate(() => window.__na!.view!.tick)).toBeLessThan(10);
});

test('Kane speed button scales actual automatic tick rate', async ({ page }) => {
  await page.goto('/?kane=1');
  const speed = page.getByTestId('kane-speed');
  await expect(speed).toHaveText('Speed 0.25x');
  const sample = () => page.evaluate(async () => {
    const before = window.__na!.view!.tick;
    // Count delivered animation time: heavily stalled frames intentionally lose
    // wall time at the driver's 250ms clamp (e.g. concurrent SwiftShader tests).
    await new Promise<void>(resolve => {
      let previous = performance.now(), elapsed = 0;
      const frame = (now: number) => {
        elapsed += Math.min(now - previous, 250); previous = now;
        if (elapsed >= 1600) resolve(); else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    return window.__na!.view!.tick - before;
  });
  const slow = await sample();
  await speed.click(); await speed.click(); await speed.click();
  await expect(speed).toHaveText('Speed 2x');
  const fast = await sample();
  expect(slow).toBeGreaterThanOrEqual(7);
  expect(slow).toBeLessThanOrEqual(10);
  expect(fast).toBeGreaterThan(slow * 4);
});

test('common campaign has no Kane shell and retains its HUD controls', async ({ page }) => {
  await openLevel(page);
  await expect(page.getByTestId('kane-overlay')).toHaveCount(0);
  await expect(page.getByTestId('kane-speed')).toHaveCount(0);
  await expect(page.locator('#game-hud button')).toHaveCount(3);
});
