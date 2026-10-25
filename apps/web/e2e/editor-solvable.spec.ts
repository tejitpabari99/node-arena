import { expect, test } from '@playwright/test';

test('Check runs on the unsaved working copy and displays streamed proxy evidence', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev editor');
  let saves = 0;
  page.on('request', request => { if (request.url().endsWith('/__editor/save')) saves++; });
  await page.goto('/editor.html');
  await page.getByLabel('New level id').fill('na-proxy-browser');
  await page.getByRole('combobox', { name: 'Copy level', exact: true }).selectOption('levelview-1');
  await page.getByRole('button', { name: 'Copy level', exact: true }).click();
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByLabel('Proxy evidence')).toContainText('Proxy wins:', { timeout: 30000 });
  await expect(page.getByLabel('Proxy evidence')).toContainText('Evidence only');
  await expect(page.getByLabel('Proxy evidence')).toContainText('seed');
  await expect(page.getByRole('button', { name: 'Check', exact: true })).toBeEnabled();
  expect(saves).toBe(0);
  await page.getByLabel('Level name', { exact: true }).fill('Changed after check');
  await page.getByRole('button', { name: 'Apply level properties', exact: true }).click();
  await expect(page.getByLabel('Proxy evidence')).toHaveCount(0);
  expect(saves).toBe(0);
});

test('Check popover Cancel aborts the running check', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev editor');
  let saves = 0, aborted = false;
  page.on('request', request => { if (request.url().endsWith('/__editor/save')) saves++; });
  page.on('requestfailed', request => { if (request.url().endsWith('/__editor/solvable')) aborted = true; });
  await page.route('**/__editor/solvable', () => new Promise(() => undefined));
  await page.goto('/editor.html');
  await page.getByLabel('New level id').fill('na-proxy-cancel');
  await page.getByRole('combobox', { name: 'Copy level', exact: true }).selectOption('levelview-1');
  await page.getByRole('button', { name: 'Copy level', exact: true }).click();
  const check = page.getByRole('button', { name: 'Check', exact: true });
  await check.click();
  const popover = page.getByTestId('check-popover');
  await expect(popover.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(check).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await popover.getByRole('button', { name: 'Close' }).click();
  await expect(popover).toHaveCount(0);
  await expect(check).toBeDisabled(); // closing never cancels
  await page.getByRole('button', { name: 'Check details' }).click();
  await popover.getByRole('button', { name: 'Cancel' }).click();
  await expect(popover).toContainText('Proxy check cancelled.');
  await expect(check).toBeEnabled();
  expect(aborted).toBe(true);
  expect(saves).toBe(0);
});
