import { test, expect } from '@playwright/test';
import type { LevelDoc } from '../src/editor/document.js';

test('Finalize requires saved draft, streams steps, and refreshes disk status without blocking edits', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev editor');
  let current = false, statusRequests = 0, finalizes = 0;
  await page.route('**/__editor/status', async route => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-na-editor']).toBe('1');
    statusRequests++;
    await new Promise(done => setTimeout(done, 300));
    await route.fulfill({ json: { unfinalized: !current, exitCode: current ? 0 : 1, output: 'content guard' } });
  });
  await page.route('**/__editor/save', async route => {
    const level = (route.request().postDataJSON() as { level: LevelDoc }).level;
    await route.fulfill({ json: { level, warnings: [] } });
  });
  await page.route('**/__editor/finalize', async route => {
    finalizes++; current = true;
    const events = [{ type: 'started', id: 'na-finalize-browser' }, { type: 'step', step: 'content:lock' }, { type: 'output', step: 'content:lock', output: 'Wrote hashes.lock.json\n' }, { type: 'completed', step: 'content:lock', exitCode: 0 }, { type: 'result' }];
    await route.fulfill({ contentType: 'application/x-ndjson', body: events.map(event => JSON.stringify(event)).join('\n') + '\n' });
  });
  let finalizeBody = '';
  page.on('request', request => { if (request.url().endsWith('/__editor/finalize')) finalizeBody = request.postData() ?? ''; });
  await page.goto('/editor.html');
  await page.getByLabel('New level id').fill('na-finalize-browser');
  await page.getByLabel('Copy level').selectOption('levelview-1');
  await page.getByRole('button', { name: 'Copy level', exact: true }).click();
  const finalize = page.getByRole('button', { name: 'Finalize', exact: true });
  const popover = page.getByTestId('finalize-popover');
  await expect(finalize).toBeDisabled();
  // Lock text only lives in the popover, fetched lazily on open.
  await expect(page.getByText('Content locks current')).toHaveCount(0);
  await expect(page.getByText('Unfinalized changes')).toHaveCount(0);
  expect(statusRequests).toBe(0);
  await page.getByRole('button', { name: 'Finalize details' }).click();
  await expect(popover).toContainText('Unfinalized changes on disk');
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(page.getByText('Unfinalized changes')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(finalize).toBeEnabled();
  await finalize.click();
  await expect(popover).toBeVisible();
  await expect(page.getByLabel('Finalize output')).toContainText('Wrote hashes.lock.json');
  await expect(popover).toContainText('Content locks current');
  expect(JSON.parse(finalizeBody).level.id).toBe('na-finalize-browser');
  await popover.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('Content locks current')).toHaveCount(0);
  await page.getByText('Level properties', { exact: true }).click();
  await page.getByLabel('Level name', { exact: true }).fill('Changed after Finalize');
  await page.getByRole('button', { name: 'Apply level properties' }).click();
  await expect(finalize).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  expect(finalizes).toBe(1); expect(statusRequests).toBeGreaterThanOrEqual(2);
});
