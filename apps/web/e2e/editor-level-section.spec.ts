import { test, expect, type Page } from '@playwright/test';
import type { LevelDoc } from '../src/editor/document.js';

async function open(page: Page, saved: { doc?: LevelDoc }, owned: { n: number }) {
  await page.route('**/__editor/level/levelview-1', async route => {
    const doc = await (await route.fetch()).json() as LevelDoc;
    owned.n = doc.buildings.filter(b => b.owner === 'p2').length;
    await route.fulfill({ json: doc });
  });
  await page.route('**/__editor/save', async route => {
    saved.doc = (route.request().postDataJSON() as { level: LevelDoc }).level;
    await route.fulfill({ json: { level: saved.doc, warnings: [] } });
  });
  await page.goto('/editor.html');
  await page.getByLabel('New level id').fill('na-level-section');
  await page.getByLabel('Copy level').selectOption('levelview-1');
  await page.getByRole('button', { name: 'Copy level', exact: true }).click();
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
}

test('Level section: add/delete AI, duplicate block, one undo step, owners nulled', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Editor API is dev-only');
  const saved: { doc?: LevelDoc } = {}, owned = { n: 0 };
  await open(page, saved, owned);
  const apply = page.getByRole('button', { name: 'Apply level properties' });
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(apply).toBeDisabled();
  const before = await page.locator('.ed-player').count();
  const addAi = page.getByRole('button', { name: 'Add AI', exact: true });
  // Add until AI cap (3).
  while (await addAi.isEnabled()) await addAi.click();
  await expect(page.locator('.ed-player')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'AI3 card' })).toBeVisible();
  await expect(addAi).toBeDisabled();
  const colors = await page.locator('.ed-swatch').evaluateAll(els => els.map(e => (e as HTMLElement).title));
  expect(new Set(colors).size).toBe(colors.length);
  // Duplicate color blocks Apply with inline note.
  await page.getByRole('button', { name: 'AI3 card' }).click();
  await page.getByLabel('AI3 color').selectOption(colors[0]!);
  await expect(page.getByText('Each player needs a unique color.')).toBeVisible();
  await expect(apply).toBeDisabled();
  await page.getByLabel('AI3 color').selectOption(colors[3]!);
  await expect(apply).toBeEnabled();
  expect(before).toBeGreaterThanOrEqual(2);
  // Delete AI3 and AI2 via confirm; cancel keeps it.
  await page.getByRole('button', { name: 'Delete AI3' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.ed-player')).toHaveCount(4);
  await page.getByRole('button', { name: 'Delete AI3' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Delete AI3?');
  await expect(page.getByRole('alertdialog')).not.toContainText('become Neutral');
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await page.getByRole('button', { name: 'Delete AI2' }).click();
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page.locator('.ed-player')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Delete AI1' })).toBeDisabled(); // last AI
  // Delete the original AI1 after adding a new one: confirm shows owned count.
  await addAi.click();
  await page.getByRole('button', { name: 'Delete AI1' }).first().click();
  expect(owned.n).toBeGreaterThan(0);
  await expect(page.getByRole('alertdialog')).toContainText(`Its ${owned.n} building${owned.n === 1 ? '' : 's'} become Neutral.`);
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(undo).toBeDisabled();
  await apply.click(); // one Apply
  await expect(undo).toBeEnabled();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => saved.doc?.players.map(p => p.id)).toEqual(['p1', 'p3']);
  expect(saved.doc!.buildings.some(b => b.owner === 'p2')).toBe(false);
  expect(saved.doc!.buildings.filter(b => b.owner === null).length).toBeGreaterThanOrEqual(owned.n);
  // A single Undo restores prior players and owners.
  await undo.click();
  await expect(undo).toBeDisabled();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => saved.doc?.players.map(p => p.id)).toEqual(['p1', 'p2']);
  expect(saved.doc!.buildings.filter(b => b.owner === 'p2')).toHaveLength(owned.n);
});
