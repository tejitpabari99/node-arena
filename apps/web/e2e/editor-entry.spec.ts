import { test, expect } from '@playwright/test';

const development = process.env.WEB_TEST_SERVER === 'dev';

test('development Edit links preserve campaign cards and target imported/custom levels', async ({ page }) => {
  test.skip(!development, 'Development entry points');
  await page.goto('/');
  await expect(page.locator('.level-grid.campaign .level-card')).toHaveCount(20);
  const cards = page.locator('.level-grid.campaign .level-card');
  const ids = await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-level-id')!));
  for (const id of ids) {
    await expect(page.getByRole('link', { name: `Edit ${id}`, exact: true })).toHaveAttribute('href', `/editor.html?level=${encodeURIComponent(id)}`);
  }
  await expect(page.getByRole('link', { name: 'Edit level', exact: true })).toHaveAttribute('href', '/editor.html');
  await expect(page.locator('.level-card button, .level-card a')).toHaveCount(0);
  await expect(cards.nth(1)).toBeDisabled();
  await page.getByRole('link', { name: `Edit ${ids[1]}`, exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Copy level', exact: true })).toHaveValue(ids[1]!);
  await expect(page.getByTestId('draft-id')).toHaveCount(0);
  await page.getByRole('button', { name: 'Copy level', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('new id');
  await page.getByLabel('New level id').fill('na-entry-copy');
  await page.getByRole('button', { name: 'Copy level', exact: true }).click();
  await expect(page.getByTestId('draft-id')).toHaveText('na-entry-copy');
  await page.goto('/');
  await page.getByRole('link', { name: 'Edit na-trial', exact: true }).click();
  await expect(page.getByTestId('draft-id')).toHaveText('na-trial');
});

test('global Edit targets active level and unknown query ids do not open a document', async ({ page }) => {
  test.skip(!development, 'Development entry points');
  await page.goto('/');
  const first = page.locator('.level-grid.campaign .level-card').first();
  const id = await first.getAttribute('data-level-id');
  await first.click();
  await expect(page.getByRole('link', { name: 'Edit level', exact: true })).toHaveAttribute('href', `/editor.html?level=${id}`);
  await page.goto('/editor.html?level=..%2Fcontent');
  await expect(page.getByRole('alert')).toContainText('Unknown level');
  await expect(page.getByTestId('draft-id')).toHaveCount(0);
});

test('test-hooks build does not expose development Edit links', async ({ page }) => {
  test.skip(development, 'Production env despite test hooks');
  await page.goto('/');
  await expect(page.locator('.level-grid.campaign .level-card')).toHaveCount(20);
  await expect(page.getByRole('link', { name: /^Edit / })).toHaveCount(0);
});
