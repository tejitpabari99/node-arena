// Named z-* so it runs last: its real level write/removal invalidates the dev server's content graph for other specs.
import { test, expect } from '@playwright/test';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { draw } from './helpers';
const development = process.env.WEB_TEST_SERVER === 'dev';
const data = fileURLToPath(new URL('../../../packages/content/data', import.meta.url));
const customJson = resolve(data, 'campaigns/custom.json');

test('Custom → Create custom level from template → place → Save → appears in Custom → plays with placed building', async ({ page }) => {
  test.skip(!development, 'Editor is dev-only');
  test.setTimeout(120000);
  const original = await readFile(customJson, 'utf8');
  let createdId = '';
  try {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/?test=1');
    await page.getByRole('button', { name: 'Custom', exact: true }).click();
    await page.getByRole('button', { name: 'Create custom level', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Start from a level' })).toBeVisible();
    await expect(page.locator('.template-card')).toHaveCount(21);
    await expect(page.getByRole('button', { name: 'Create and edit', exact: true })).toHaveAttribute('aria-disabled', 'true');
    await page.locator('.template-card[data-template-id="na-trial"]').click();
    await page.getByRole('button', { name: 'Create and edit', exact: true }).click();
    const draft = page.getByTestId('level-name');
    await expect(draft).toHaveAttribute('title', /^na-custom-\d+$/);
    createdId = (await draft.getAttribute('title'))!;
    expect(createdId).not.toBe('na-trial');
    const before = Number(await page.locator('.ed-shell').getAttribute('data-buildings'));
    const host = page.getByLabel('Edit viewport'), box = (await host.boundingBox())!;
    const item = page.getByRole('button', { name: 'Place house-wt1', exact: true }), source = (await item.boundingBox())!;
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', String(before + 1));
    // The dev watcher may reload the page right after the write, so assert the save response, not the transient chip.
    const saveResponse = page.waitForResponse(response => response.url().includes('/__editor/save'));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await saveResponse).ok()).toBe(true);
    // Dev server picks up the new level file via its watcher and may reload the page: retry the whole navigation.
    const card = page.locator(`.level-grid.custom .level-card[data-level-id="${createdId}"]`);
    await expect(async () => {
      await page.goto('/?test=1', { timeout: 15000 });
      await page.getByRole('button', { name: 'Custom', exact: true }).click({ timeout: 5000 });
      await expect(card).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 60000 });
    await expect(page.locator('.level-grid.custom .level-card[data-level-id="na-trial"]')).toBeVisible();
    await card.click();
    await expect.poll(() => page.evaluate(() => window.__na?.screen)).toBe('playing');
    expect(await page.evaluate(() => window.__na!.view!.buildings.owner.length)).toBe(before + 1);
    expect(errors).toEqual([]);
  } finally {
    await writeFile(customJson, original);
    if (createdId) await rm(resolve(data, `levels/${createdId}.json`), { force: true });
  }
});

test('custom win has no Next level or "All levels complete"; Levels returns to Custom; campaign cards have no Edit', async ({ page }) => {
  await page.goto('/?test=1&fixture=win');
  await page.getByRole('button', { name: 'Campaign', exact: true }).click();
  await expect(page.locator('.level-edit')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await page.locator('.level-grid.custom .level-card[data-level-id]').first().click();
  await expect.poll(() => page.evaluate(() => window.__na?.screen)).toBe('playing');
  await draw(page);
  await expect(page.getByRole('dialog', { name: 'Victory!' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next level' })).toHaveCount(0);
  await expect(page.getByText('All levels complete!')).toHaveCount(0);
  await page.getByRole('button', { name: 'Levels', exact: true }).click();
  await expect(page.locator('.level-grid.custom')).toBeVisible();
});
