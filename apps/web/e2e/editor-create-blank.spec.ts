import { test, expect, type Page } from '@playwright/test';
import { copyFrom, createBlank, openFile } from './editor-helpers.js';

test.beforeEach(() => test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev-only editor'));

async function placeBuilding(page: Page) {
  const box = (await page.getByLabel('Edit viewport').boundingBox())!, item = page.getByRole('button', { name: 'Place house-wt1', exact: true }), source = (await item.boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .45, box.y + box.height * .45, { steps: 8 }); await page.mouse.up();
}
async function expectBlankRenders(page: Page, id: string, theme: string) {
  await expect(page.getByLabel('Level id', { exact: true })).toHaveText(id);
  await expect(page.getByLabel('Level theme', { exact: true })).toHaveValue(theme);
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  await expect(page.getByLabel('Edit viewport').locator('canvas')).toBeVisible();
  await expect(page.getByTestId('preview-error')).toHaveCount(0);
  await expect(page.getByText('fewer than 1')).toHaveCount(0);
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', '2');
  await placeBuilding(page);
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', '3');
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  await expect(page.getByTestId('preview-error')).toHaveCount(0);
}

for (const theme of ['green', 'snow']) for (const size of ['small', 'medium', 'large']) {
  test(`File->Create blank ${theme}/${size} renders the map with its two base houses and accepts a building`, async ({ page }) => {
    await page.goto('/editor.html');
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    await page.getByLabel('Size', { exact: true }).selectOption(size);
    await createBlank(page, `na-blank-${theme}-${size}`);
    await expectBlankRenders(page, `na-blank-${theme}-${size}`, theme);
  });
}

test('File->Create blank from an open level and ?create=1 both render the base-house map', async ({ page }) => {
  await page.goto('/editor.html?create=1');
  await page.getByLabel('Theme', { exact: true }).selectOption('snow');
  await createBlank(page, 'na-blank-handoff');
  await expectBlankRenders(page, 'na-blank-handoff', 'snow');
  await openFile(page, 'create');
  await page.getByLabel('New level id').fill('na-blank-second');
  await page.getByTestId('create-confirm').click();
  await page.getByTestId('confirm-discard').click();
  await expectBlankRenders(page, 'na-blank-second', 'green');
});

test('create by copying keeps the source buildings from both entry points', async ({ page }) => {
  await page.goto('/editor.html?create=1');
  await copyFrom(page, 'levelview-1', 'na-copy-handoff');
  await expect(page.getByLabel('Level id', { exact: true })).toHaveText('na-copy-handoff');
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  const count = Number(await page.locator('.ed-shell').getAttribute('data-buildings'));
  expect(count).toBeGreaterThan(0);
  await openFile(page, 'create');
  await page.getByLabel('Copy existing level', { exact: true }).selectOption('levelview-1');
  await page.getByLabel('New level id').fill('na-copy-menu');
  await page.getByTestId('create-confirm').click();
  await page.getByTestId('confirm-discard').click();
  await expect(page.getByLabel('Level id', { exact: true })).toHaveText('na-copy-menu');
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', String(count));
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
});

test('deleting every building keeps the preview healthy, lists per-player issues and blocks Play', async ({ page }) => {
  await page.goto('/editor.html');
  await createBlank(page, 'na-blank-owners');
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  const shell = page.locator('.ed-shell');
  // Put an obstacle on the map so the zero-building preview has an element to convert.
  const box = (await page.getByLabel('Edit viewport').boundingBox())!, src = (await page.getByRole('button', { name: 'Place obstacle-small', exact: true }).boundingBox())!;
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5, { steps: 8 }); await page.mouse.up();
  await expect(shell).toHaveAttribute('data-obstacles', '1');
  // Delete one house: the other player is flagged; Play is blocked with the issue shown.
  await page.getByLabel('Selected item', { exact: true }).selectOption({ label: 'AI1 house 1' });
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(shell).toHaveAttribute('data-buildings', '1');
  await expect(page.getByTestId('save-chip')).toHaveText(/^1 issues?$/);
  await page.getByTestId('save-chip').click();
  await expect(page.getByTestId('save-popover')).toContainText('AI1 has no building — add one and set its owner to AI1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByTestId('ownership-blocked')).toContainText('AI1 has no building');
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  // Delete the last house: no stale banner, one issue per player, no generic message.
  await page.getByLabel('Selected item', { exact: true }).selectOption({ label: 'Human house 1' });
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(shell).toHaveAttribute('data-buildings', '0');
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  await expect(page.getByTestId('preview-error')).toHaveCount(0);
  await page.getByTestId('save-chip').click();
  const popover = page.getByTestId('save-popover');
  await expect(popover).toContainText('Human has no building — add one and set its owner to Human');
  await expect(popover).toContainText('AI1 has no building — add one and set its owner to AI1');
  await expect(popover).not.toContainText('Add at least one building');
  await expect(page.getByTestId('viewport-selection')).not.toContainText('b0');
});
