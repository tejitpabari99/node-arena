import { test, expect } from '@playwright/test';

const development = process.env.WEB_TEST_SERVER === 'dev';

test('campaign cards have no Edit links; custom cards edit na- levels; global Edit link stays on menus', async ({ page }) => {
  test.skip(!development, 'Development entry points');
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Edit level', exact: true })).toHaveAttribute('href', '/editor.html');
  await page.getByRole('button', { name: 'Campaign', exact: true }).click();
  await expect(page.locator('.level-grid.campaign .level-card')).toHaveCount(20);
  await expect(page.locator('.level-edit')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Edit na-trial', exact: true })).toHaveAttribute('href', '/editor.html?level=na-trial');
  await page.getByRole('link', { name: 'Edit na-trial', exact: true }).click();
  await expect(page.getByTestId('draft-id')).toHaveText('na-trial');
});

test('global Edit link is hidden in campaign levels, shown for custom levels; unknown query ids do not open a document', async ({ page }) => {
  test.skip(!development, 'Development entry points');
  await page.goto('/');
  await page.getByRole('button', { name: 'Campaign', exact: true }).click();
  await page.locator('.level-grid.campaign .level-card').first().click();
  await expect(page.locator('#game-hud')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit level', exact: true })).toHaveCount(0);
  await page.goto('/');
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await page.locator('.level-grid.custom .level-card[data-level-id="na-trial"]').click();
  await expect(page.locator('#game-hud')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit level', exact: true })).toHaveAttribute('href', '/editor.html?level=na-trial');
  await page.goto('/editor.html?level=..%2Fcontent');
  await expect(page.getByRole('alert')).toContainText('Unknown level');
  await expect(page.getByTestId('draft-id')).toHaveCount(0);
});

test('test-hooks build does not expose development Edit links', async ({ page }) => {
  test.skip(development, 'Production env despite test hooks');
  await page.goto('/');
  await page.getByRole('button', { name: 'Campaign', exact: true }).click();
  await expect(page.locator('.level-grid.campaign .level-card')).toHaveCount(20);
  await expect(page.getByRole('link', { name: /^Edit / })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await expect(page.getByRole('link', { name: /^Edit / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create custom level' })).toHaveCount(0);
});
