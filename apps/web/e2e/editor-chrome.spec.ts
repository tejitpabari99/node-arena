import { openCopied } from './editor-helpers.js';
import { test, expect } from '@playwright/test';
import type { SeatBot } from '@node-arena/content';
import type { LevelDoc } from '../src/editor/document.js';

const development = process.env.WEB_TEST_SERVER === 'dev';

test('editor Play result shows Replay + Edit level (no Levels); Edit level returns to the editor', async ({ page }) => {
  test.skip(!development, 'Dev editor'); test.setTimeout(60000);
  await page.route('**/__editor/level/levelview-1', async route => {
    const doc = await (await route.fetch()).json() as LevelDoc;
    doc.buildings = [
      { id: 'b0', archetype: 'house-wt1', pos: { x: -3, z: 0 }, owner: 'p1', level: 1, ignoreForWin: false },
      { id: 'b1', archetype: 'house-wt1', pos: { x: 3, z: 0 }, owner: 'p2', level: 1, ignoreForWin: false },
      { id: 'b2', archetype: 'house-wt1', pos: { x: 3, z: 3 }, owner: 'p2', level: 1, ignoreForWin: false },
    ];
    (doc.players[1]!.bot! as SeatBot).script = [{ op: 'line', own: 'b2', target: 'b0', afterMs: 0 }];
    await route.fulfill({ json: doc });
  });
  await openCopied(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const result = page.getByRole('dialog', { name: 'Defeat', exact: true });
  await expect(result).toBeVisible({ timeout: 20000 });
  await expect(result.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(result.getByRole('button', { name: 'Edit level', exact: true })).toBeVisible();
  await expect(result.getByRole('button', { name: 'Levels', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back to editor', exact: true })).toBeVisible();
  await result.getByRole('button', { name: 'Edit level', exact: true }).click();
  await expect(page.locator('.editor-play-overlay')).toHaveCount(0);
  await expect(page.locator('.ed-shell')).toBeVisible();
});

test('no Edit level link on menu or campaign level; editor Back lands on Custom levels', async ({ page }) => {
  test.skip(!development, 'Dev editor');
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Edit level', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Campaign', exact: true }).click();
  await page.locator('.level-grid.campaign .level-card').first().click();
  await expect(page.locator('#game-hud')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit level', exact: true })).toHaveCount(0);
  await page.goto('/editor.html?level=na-trial');
  await page.getByTestId('back').click();
  await expect(page).toHaveURL(/\/\?view=custom$/);
  await expect(page.getByRole('heading', { name: 'Custom levels', exact: true })).toBeVisible();
});
