import { test, expect } from '@playwright/test';

test('Library: five ordered tiles with art or text fallback; drag places an item', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Editor API is dev-only');
  await page.goto('/editor.html?template=levelview-1');
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  const tiles = page.locator('.ed-library-tile');
  await expect(tiles).toHaveCount(5);
  expect(await tiles.evaluateAll(list => list.map(t => t.getAttribute('aria-label')))).toEqual(['Place house-wt1', 'Place house-wt2', 'Place tower', 'Place obstacle-small', 'Place obstacle-big']);
  for (const [i, label] of ['House 1', 'House 2', 'Tower', 'Small obstacle', 'Big obstacle'].entries()) await expect(tiles.nth(i)).toContainText(label);
  // Each tile shows an image once thumbnails are ready, else the text fallback.
  await expect.poll(async () => await tiles.locator('img').count() + await tiles.locator('.ed-library-fallback').count(), { timeout: 30_000 }).toBe(5);
  await expect(tiles.first()).toHaveCSS('touch-action', 'none');
  const before = await page.evaluate(() => document.querySelectorAll('canvas').length);
  expect(before).toBeGreaterThan(0);
  const box = (await page.getByLabel('Edit viewport').boundingBox())!, source = (await page.getByRole('button', { name: 'Place tower', exact: true }).boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5, { steps: 8 }); await page.mouse.up();
  await expect(page.getByTestId('viewport-selection')).toContainText('building');
});
