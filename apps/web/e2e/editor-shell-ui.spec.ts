import { test, expect, type Page, type Route } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const development = process.env.WEB_TEST_SERVER === 'dev';
declare global { interface Window { __editorSave?: (source?: 'manual' | 'auto') => Promise<void> } }

/** Echo the posted level back, like a server that normalizes nothing; optionally held until `release`. */
async function mockSave(page: Page, hold?: Promise<void>) {
  const posted: unknown[] = [];
  await page.route('**/__editor/save', async (route: Route) => {
    const body = route.request().postDataJSON() as { level: unknown };
    posted.push(body.level);
    if (hold) await hold;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ level: body.level, warnings: [] }) });
  });
  return posted;
}
async function placeBuilding(page: Page) {
  const box = (await page.getByLabel('Edit viewport').boundingBox())!, item = page.getByRole('button', { name: 'Place house-wt1', exact: true }), source = (await item.boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .45, box.y + box.height * .45, { steps: 8 }); await page.mouse.up();
}

test('chip walks Unsaved, Saving, Saved and back to Unsaved on edit', async ({ page }) => {
  test.skip(!development, 'Editor API is dev-only');
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  await mockSave(page, hold);
  await page.goto('/editor.html?template=levelview-1');
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  const chip = page.getByTestId('save-chip');
  await expect(chip).toHaveText('Unsaved');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(chip).toHaveText('Saving…');
  release();
  await expect(chip).toHaveText('Saved ✓');
  const before = Number(await page.locator('.ed-shell').getAttribute('data-buildings'));
  await placeBuilding(page);
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', String(before + 1));
  await expect(chip).toHaveText('Unsaved');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(chip).toHaveText('Saved ✓');
  await page.setViewportSize({ width: 1280, height: 720 });
  const dir = process.env.SHOT_DIR; if (dir) { mkdirSync(dir, { recursive: true }); await page.locator('.ed-top').screenshot({ path: `${dir}/topbar-1280x720.png` }); }
});

test('blank document Save lists issues in the chip popover; level-name exposes id', async ({ page }) => {
  test.skip(!development, 'Editor API is dev-only');
  await page.goto('/editor.html');
  await page.getByLabel('New level id').fill('na-chip-blank');
  await page.getByRole('button', { name: 'Create blank' }).click();
  const chip = page.getByTestId('save-chip');
  await expect(page.getByTestId('level-name')).toHaveAttribute('title', 'na-chip-blank');
  await expect(chip).toHaveText('Unsaved');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(chip).toHaveText(/^Can't save · \d+ issues$/);
  await chip.click();
  await expect(page.getByTestId('save-popover')).toContainText('must NOT have fewer than 1 items');
  await expect(page.getByTestId('save-popover').locator('li[data-item]').first()).toBeVisible();
});

test('an edit made during a stalled save survives and the chip stays Unsaved', async ({ page }) => {
  test.skip(!development, 'Editor API is dev-only');
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  const posted = await mockSave(page, hold);
  await page.goto('/editor.html?template=levelview-1');
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  const before = Number(await page.locator('.ed-shell').getAttribute('data-buildings'));
  const chip = page.getByTestId('save-chip');
  void page.evaluate(() => window.__editorSave!('auto'));
  await expect(chip).toHaveText('Saving…');
  expect(posted.length).toBe(1);
  await placeBuilding(page);
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', String(before + 1));
  release();
  await expect(chip).toHaveText('Unsaved');
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', String(before + 1));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', String(before));
  await expect(chip).toHaveText('Saved ✓');
});
