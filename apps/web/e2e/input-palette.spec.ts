import { expect, test, type Page } from '@playwright/test';
import type { TestApi } from '../src/test-harness';

declare global { interface Window { __na?: TestApi } }
test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

async function boot(page: Page, colorblind: boolean) {
  await page.addInitScript(colorblind => localStorage.setItem('nodearena:save', JSON.stringify({
    v: 1, completed: {}, lastLevel: null,
    settings: { musicVol: .7, sfxVol: 1, musicMute: true, sfxMute: true,
      colorblind, quality: 'low', reducedMotion: true },
  })), colorblind);
  await page.goto('/?test=1&fixture=normal');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await page.evaluate(() => window.__na!.load('fixture-1'));
  await expect(page.locator('main')).toHaveAttribute('data-screen', 'playing');
}
async function drag(page: Page) {
  const from = await page.evaluate(() => window.__na!.project('t1'));
  const to = await page.evaluate(() => window.__na!.project('t2'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.evaluate(() => window.__na!.render());
  return { from, to };
}
async function expectPreview(page: Page, color: string) {
  expect(await page.evaluate(() => window.__na!.presentation().inputPreview)).toEqual({ visible: true, color });
}
async function expectRoute(page: Page, color: string) {
  expect(await page.evaluate(() => window.__na!.presentation().lines)).toEqual([{ color }]);
}
async function commit(page: Page) {
  await page.mouse.up();
  expect(await page.evaluate(() => window.__na!.view!.channels.filter(channel => channel.drawn))).toHaveLength(0);
  await page.evaluate(() => window.__na!.step());
  expect(await page.evaluate(() => window.__na!.view!.channels.filter(channel => channel.drawn))).toHaveLength(1);
}

for (const colorblind of [false, true]) test(`saved ${colorblind ? 'colourblind' : 'default'} palette colors both valid preview and route`, async ({ page }) => {
  await boot(page, colorblind);
  await drag(page);
  const color = colorblind ? '0072b2' : '2e8bff';
  await expect(page.locator('[data-input-reason]')).toBeHidden();
  await expectPreview(page, color);
  await commit(page);
  await expectRoute(page, color);
  await drag(page);
  await expect(page.locator('[data-input-reason]')).toHaveText('duplicate');
  await expect(page.locator('[data-input-reason]')).toBeVisible();
  // Invalid feedback stays explicitly red regardless of the valid team palette.
  await expectPreview(page, 'e3384f');
  await page.mouse.up();
  expect(await page.evaluate(() => window.__na!.view!.channels.filter(channel => channel.drawn))).toHaveLength(1);
});

test('pause settings update subsequent gestures and active preview without restarting the match', async ({ page }) => {
  await boot(page, false);
  const initial = await page.evaluate(() => window.__na!.hash());
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Colourblind palette' }).check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  expect(await page.evaluate(() => window.__na!.hash())).toBe(initial);
  await drag(page);
  await expectPreview(page, '0072b2');
  // Apply the same app settings path during a live gesture: it must recolor
  // immediately, retain the gesture, and enqueue exactly one eventual command.
  await page.evaluate(() => window.__na!.settings({ colorblind: false }));
  await expectPreview(page, '2e8bff');
  await page.evaluate(() => window.__na!.settings({ colorblind: true }));
  await expectPreview(page, '0072b2');
  expect(await page.evaluate(() => window.__na!.hash())).toBe(initial);
  await commit(page);
  await expectRoute(page, '0072b2');
  expect(await page.evaluate(() => window.__na!.replay().record.commands)).toHaveLength(1);
});
