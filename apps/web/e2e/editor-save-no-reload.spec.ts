import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { copyFrom, save } from './editor-helpers.js';

const data = fileURLToPath(new URL('../../../packages/content/data/', import.meta.url));
test.afterEach(() => {
  rmSync(`${data}levels/na-no-reload.json`, { force: true });
  execFileSync('git', ['checkout', '--', `${data}campaigns/custom.json`]);
});

test('Save in dev does not reload the page and the level is listed', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Editor filesystem API is dev-only');
  await page.goto('/editor.html?create=1');
  await copyFrom(page, 'levelview-1', 'na-no-reload');
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  await page.evaluate(() => { (window as unknown as { __marker: number }).__marker = 1; });
  await save(page);
  await expect(page.getByTestId('save-chip')).toHaveText('✓ Saved');
  await page.waitForTimeout(2500);
  expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1);
  const listed = await (await page.request.get('/__editor/levels')).json() as { id: string }[];
  expect(listed.map(l => l.id)).toContain('na-no-reload');
});
