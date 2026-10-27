import { test, expect } from '@playwright/test';
import { openFile } from './editor-helpers.js';

test.beforeEach(() => test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev-only editor'));

test('Custom create opens the shared Create dialog as the only surface and creates an unsaved level', async ({ page }) => {
  await page.goto('/?test=1');
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  const createLink = page.getByRole('link', { name: 'Create custom level', exact: true });
  await expect(createLink).toHaveAttribute('href', '/editor.html?create=1');
  await createLink.click();
  const dialog = page.getByRole('dialog', { name: 'Create level', exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Level editor', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('open-confirm')).toHaveCount(0);
  await expect(dialog.getByLabel('Theme', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Copy existing level')).toBeVisible();
  const body = await dialog.locator('form').innerText();
  await dialog.getByLabel('New level id').fill('na-handoff-browser');
  await dialog.getByLabel('Theme', { exact: true }).selectOption('snow');
  await dialog.getByTestId('create-confirm').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Level id', { exact: true })).toHaveText('na-handoff-browser');
  await expect(page.getByLabel('Level theme')).toHaveValue('snow');
  // Blank documents have no buildings, so validation may replace the status text.
  // The replacement guard below proves this new level still has unsaved changes.
  await openFile(page, 'create');
  await expect(dialog).toBeVisible();
  // Both routes render the exact same reusable form, including blank/copy controls.
  expect(await dialog.locator('form').innerText()).toBe(body);
  await dialog.getByLabel('New level id').fill('na-handoff-replacement');
  await dialog.getByTestId('create-confirm').click();
  await expect(page.getByRole('dialog', { name: 'Unsaved changes', exact: true })).toBeVisible();
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByLabel('Level id', { exact: true })).toHaveText('na-handoff-browser');
});

test('closing the handoff dialog returns to the game', async ({ page }) => {
  await page.goto('/editor.html?create=1');
  await expect(page.getByRole('dialog', { name: 'Create level', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(/\/\?view=custom$/);
  await expect(page.getByRole('heading', { name: 'Custom levels', exact: true })).toBeVisible();
});

test('level URL takes precedence over create and preserves the imported copy hint', async ({ page }) => {
  await page.goto('/editor.html?create=1&level=na-trial');
  await expect(page.getByLabel('Level id', { exact: true })).toHaveText('na-trial');
  await expect(page.getByRole('dialog', { name: 'Create level', exact: true })).toHaveCount(0);
  await page.goto('/editor.html?create=1&level=levelview-1');
  await expect(page.getByRole('heading', { name: 'Level editor', exact: true })).toBeVisible();
  await expect(page.getByLabel('Copy existing level')).toHaveValue('levelview-1');
  await expect(page.getByRole('dialog', { name: 'Create level', exact: true })).toHaveCount(0);
});
