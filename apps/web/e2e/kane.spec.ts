import { expect, test } from '@playwright/test';
import { draw } from './helpers';

async function openKane(page: import('@playwright/test').Page, extra = '') {
  await page.goto(`/?kane=1${extra}`);
  await expect.poll(() => page.evaluate(() => window.__na?.screen), { timeout: 20000 }).toBe('playing');
  await expect(page.locator('#arena canvas')).toBeVisible();
}

test('?kane=1 boots straight into na-kane; Levels shows a one-card kane picker, unlocked', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
  await openKane(page);
  expect(await page.evaluate(() => ({ screen: window.__na!.screen, levelId: window.__na!.state().levelId, kane: window.__na!.kane })))
    .toEqual({ screen: 'playing', levelId: 'na-kane', kane: true });
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Levels', exact: true }).click();
  await expect(page.locator('.level-grid.campaign .level-card')).toHaveCount(1);
  await expect(page.locator('.level-grid.campaign .level-card:not(:disabled)')).toHaveCount(1);
  expect(await page.evaluate(() => window.__na!.state().levels.map(l => l.id))).toEqual(['na-kane']);
  // The unlocked card starts the level again.
  await page.locator('.level-grid.campaign .level-card').first().click();
  await expect.poll(() => page.evaluate(() => window.__na!.state().levelId)).toBe('na-kane');
  await expect(page.locator('#game-hud')).toBeVisible();
  expect(errors).toEqual([]);
});

test('na-kane command log records a real draw', async ({ page }) => {
  await openKane(page, '&test=1');
  expect(await page.evaluate(() => window.__na!.commandLog)).toEqual([]);
  await draw(page);
  expect(await page.evaluate(() => window.__na!.commandLog.filter(s => s.cmd.type === 'DrawLine').length)).toBe(1);
});

test('na-kane result dialog (fixture win) and returns to the one-card picker', async ({ page }) => {
  await page.goto('/?test=1&kane=1&fixture=win');
  await expect.poll(() => page.evaluate(() => window.__na?.screen), { timeout: 20000 }).toBe('playing');
  expect(await page.evaluate(() => window.__na!.state().levelId)).toBe('na-kane');
  await draw(page);
  await page.evaluate(() => { const a = window.__na!; for (let i = 0; i < 40 && a.screen === 'playing'; i++) a.step(20); });
  await expect(page.getByRole('dialog', { name: 'All levels complete!' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next level' })).toHaveCount(0);
  expect(await page.evaluate(() => window.__na!.state().result)).toEqual({ outcome: 'won', winner: 0 });
  expect(await page.evaluate(() => Object.keys(window.__na!.state().save.completed))).toContain('na-kane');
  await page.getByRole('button', { name: 'Levels', exact: true }).click();
  await expect(page.locator('.level-grid.campaign .level-card')).toHaveCount(1);
  await expect(page.locator('.level-grid.campaign .level-card:not(:disabled)')).toHaveCount(1);
});
