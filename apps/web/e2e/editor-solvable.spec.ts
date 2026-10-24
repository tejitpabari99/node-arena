import { expect, test } from '@playwright/test';

test('Solvable checks the unsaved working copy and displays streamed proxy evidence', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev editor');
  let saves = 0;
  page.on('request', request => { if (request.url().endsWith('/__editor/save')) saves++; });
  await page.goto('/editor.html');
  await page.getByLabel('New level id').fill('na-proxy-browser');
  await page.getByRole('combobox', { name: 'Copy level', exact: true }).selectOption('levelview-1');
  await page.getByRole('button', { name: 'Copy level', exact: true }).click();
  await page.getByRole('button', { name: 'Solvable?', exact: true }).click();
  await expect(page.getByLabel('Proxy evidence')).toContainText('Proxy wins:', { timeout: 30000 });
  await expect(page.getByLabel('Proxy evidence')).toContainText('Evidence only');
  await expect(page.getByLabel('Proxy evidence')).toContainText('seed');
  await expect(page.getByRole('button', { name: 'Solvable?', exact: true })).toBeEnabled();
  expect(saves).toBe(0);
  await page.getByText('Level properties', { exact: true }).click();
  await page.getByLabel('Level name', { exact: true }).fill('Changed after check');
  await page.getByRole('button', { name: 'Apply level properties', exact: true }).click();
  await expect(page.getByLabel('Proxy evidence')).toHaveCount(0);
});
