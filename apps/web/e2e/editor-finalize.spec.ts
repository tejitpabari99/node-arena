import { save as editorSave, share, openCopied, flushEdits, clearBuildings } from './editor-helpers.js';
import { test, expect } from '@playwright/test';
import type { LevelDoc } from '../src/editor/document.js';

test('dirty Finalize saves the exact server response before streaming and refreshes disk status', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev editor');
  let current = false, statusRequests = 0, finalizes = 0;
  const order: string[] = []; let saved: LevelDoc;
  await page.route('**/__editor/status', async route => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-na-editor']).toBe('1');
    statusRequests++;
    await new Promise(done => setTimeout(done, 300));
    await route.fulfill({ json: { unfinalized: !current, exitCode: current ? 0 : 1, output: 'content guard' } });
  });
  await page.route('**/__editor/save', async route => {
    const level = (route.request().postDataJSON() as { level: LevelDoc }).level;
    order.push('save'); saved = { ...level, editorVersion: '0.0.7' };
    await route.fulfill({ json: { level: saved, warnings: [], changed: true } });
  });
  await page.route('**/__editor/finalize', async route => {
    finalizes++; current = true; order.push('finalize');
    expect(route.request().postDataJSON().level).toEqual(saved);
    const events = [{ type: 'started', id: 'na-finalize-browser' }, { type: 'step', step: 'content:lock' }, { type: 'output', step: 'content:lock', output: 'Wrote hashes.lock.json\n' }, { type: 'completed', step: 'content:lock', exitCode: 0 }, { type: 'result' }];
    await route.fulfill({ contentType: 'application/x-ndjson', body: events.map(event => JSON.stringify(event)).join('\n') + '\n' });
  });
  let finalizeBody = '';
  page.on('request', request => { if (request.url().endsWith('/__editor/finalize')) finalizeBody = request.postData() ?? ''; });
  await page.goto('/editor.html');
  await page.getByLabel('New level id').fill('na-finalize-browser');
  await page.getByLabel('Copy existing level', { exact: true }).selectOption('levelview-1');
  await page.getByTestId('create-confirm').click();
  const finalize = page.getByRole('button', { name: 'Finalize', exact: true });
  const popover = page.getByTestId('share-panel');
  await expect(page.getByTestId('share-button')).toBeEnabled();
  // Lock text only lives in the popover, fetched lazily on open.
  await expect(page.getByText('Content locks current')).toHaveCount(0);
  await expect(page.getByText('Unfinalized changes')).toHaveCount(0);
  expect(statusRequests).toBe(0);
  await share(page);
  await expect(popover).toContainText('Unfinalized changes on disk');
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(page.getByText('Unfinalized changes')).toHaveCount(0);
  await share(page);
  await expect(finalize).toBeEnabled();
  await finalize.click();
  await expect(popover).toBeVisible();
  await popover.getByText('Finalize output', { exact: true }).click();
  await expect(popover).toContainText('Wrote hashes.lock.json');
  await expect(popover).toContainText('Content locks current');
  expect(JSON.parse(finalizeBody).level.id).toBe('na-finalize-browser');
  expect(order).toEqual(['save', 'finalize']);
  await page.getByTestId('share-button').click();
  await expect(page.getByText('Content locks current')).toHaveCount(0);
  await page.getByLabel('Level name', { exact: true }).fill('Changed after Finalize');
  await flushEdits(page);
  await share(page);
  await expect(finalize).toBeEnabled();
  await expect(page.getByTestId('share-panel').getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  expect(finalizes).toBe(1); expect(statusRequests).toBeGreaterThanOrEqual(2);
});


for (const invalid of [true, false]) test(`Finalize aborts and surfaces ${invalid ? 'invalid document issues' : 'server save failure'}`, async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev editor');
  let saves = 0, finalizes = 0;
  await page.route('**/__editor/save', async route => { saves++; await route.fulfill({ status: 500, json: { error: 'disk full' } }); });
  await page.route('**/__editor/finalize', async route => { finalizes++; await route.fulfill({ status: 500, json: { error: 'unexpected finalize' } }); });
  if (invalid) await page.goto('/editor.html'); else await openCopied(page);
  if (invalid) {
    await page.getByLabel('New level id').fill('na-finalize-invalid');
    await page.getByTestId('create-confirm').click();
    await clearBuildings(page);
  }
  await share(page);
  await page.getByRole('button', { name: 'Finalize', exact: true }).click();
  if (invalid) { await expect(page.getByTestId('ownership-blocked')).toContainText('Human has no troop building'); await page.getByTestId('save-chip').click(); }
  await expect(page.getByTestId('save-chip')).toHaveText(invalid ? /^\d+ issues$/ : "Can't save");
  await expect(page.getByTestId('save-popover')).toContainText(invalid ? 'Human has no troop building' : 'disk full');
  if (invalid) await share(page);
  await expect(page.getByRole('button', { name: 'Finalize', exact: true })).toBeEnabled();
  expect(saves).toBe(invalid ? 0 : 1); expect(finalizes).toBe(0);
});

test('Finalize waits behind autosave and keeps edits and competing jobs locked through its own save', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev editor');
  let releaseAuto!: () => void, releaseManual!: () => void, releaseFinalize!: () => void;
  const auto = new Promise<void>(resolve => { releaseAuto = resolve; });
  const manual = new Promise<void>(resolve => { releaseManual = resolve; });
  const finishing = new Promise<void>(resolve => { releaseFinalize = resolve; });
  const order: string[] = []; let saved: LevelDoc;
  await page.route('**/__editor/save', async route => {
    order.push('save'); const call = order.length;
    const level = route.request().postDataJSON().level as LevelDoc;
    await (call === 1 ? auto : manual);
    saved = { ...level, editorVersion: `0.0.${call}` };
    await route.fulfill({ json: { level: saved, warnings: [], changed: true } });
  });
  await page.route('**/__editor/finalize', async route => {
    order.push('finalize'); expect(route.request().postDataJSON().level).toEqual(saved);
    expect(saved.name).toBe('Edited while autosave waits');
    await finishing;
    await route.fulfill({ contentType: 'application/x-ndjson', body: '{"type":"result"}\n' });
  });
  await openCopied(page);
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  void page.evaluate(() => window.__editorSave!('auto'));
  await expect.poll(() => order.length).toBe(1);
  await page.getByLabel('Level name', { exact: true }).fill('Edited while autosave waits');
  await flushEdits(page);
  await share(page);
  await page.getByRole('button', { name: 'Finalize', exact: true }).click();
  // Save exists in both the toolbar and Share panel; both must remain locked.
  const saves = page.getByRole('button', { name: 'Save', exact: true });
  await expect(saves).toHaveCount(2);
  for (const button of await saves.all()) await expect(button).toBeDisabled();
  for (const name of ['Play', 'Check', 'Finalize']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  releaseAuto();
  await expect.poll(() => order.length).toBe(2);
  await expect(page.getByTestId('share-panel').getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  releaseManual();
  await expect.poll(() => order).toEqual(['save', 'save', 'finalize']);
  await expect(page.getByTestId('share-panel').getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  releaseFinalize();
  await expect(page.getByTestId('share-panel').getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
});


test('a failed no-change save cannot Finalize using an older saved baseline', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev editor');
  let calls = 0, finalizes = 0;
  await page.route('**/__editor/save', async route => {
    calls++;
    if (calls === 1) await route.fulfill({ json: { level: { ...route.request().postDataJSON().level, editorVersion: '0.0.1' }, warnings: [], changed: true } });
    else await route.fulfill({ status: 500, json: { error: 'disk unavailable' } });
  });
  await page.route('**/__editor/finalize', async route => { finalizes++; await route.fulfill({ contentType: 'application/x-ndjson', body: '{"type":"result"}\n' }); });
  await openCopied(page);
  await editorSave(page);
  await expect(page.getByTestId('save-chip')).toHaveText('✓ Saved');
  await share(page);
  await page.getByRole('button', { name: 'Finalize', exact: true }).click();
  await expect(page.getByTestId('save-message')).toHaveText('disk unavailable');
  await expect(page.getByRole('button', { name: 'Finalize', exact: true })).toBeEnabled();
  expect(calls).toBe(2); expect(finalizes).toBe(0);
});

test('starting Finalize closes an open Check details flyout', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev editor');
  await page.route('**/__editor/solvable', route => route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'result', report: { totalWins: 2, runs: 3, ok: true } }) + '\n' }));
  await page.route('**/__editor/save', route => route.fulfill({ json: { level: { ...route.request().postDataJSON().level, editorVersion: '0.0.1' }, warnings: [], changed: true } }));
  await page.route('**/__editor/finalize', route => route.fulfill({ contentType: 'application/x-ndjson', body: '{"type":"result"}\n' }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await openCopied(page);
  await page.getByLabel('Level name', { exact: true }).fill('Edited before finalize');
  await flushEdits(page);
  await share(page);
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await page.getByTestId('check-toast').getByRole('button', { name: 'Details' }).click();
  await expect(page.getByTestId('check-popover')).toBeVisible();
  await page.getByRole('button', { name: 'Finalize', exact: true }).click();
  await expect(page.getByTestId('check-popover')).toHaveCount(0);
  await expect(page.locator('.ed-toast-success', { hasText: 'Finalize complete.' })).toBeVisible();
});

test('a successful save whose level-list refresh fails still lets Finalize proceed', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev editor');
  let finalizes = 0, failList = false;
  await page.route('**/__editor/levels', route => failList ? route.fulfill({ status: 500, json: { error: 'list down' } }) : route.fallback());
  await page.route('**/__editor/save', route => { failList = true; return route.fulfill({ json: { level: { ...route.request().postDataJSON().level, editorVersion: '0.0.1' }, warnings: [], changed: true } }); });
  await page.route('**/__editor/finalize', route => { finalizes++; return route.fulfill({ contentType: 'application/x-ndjson', body: '{"type":"result"}\n' }); });
  await openCopied(page);
  await page.getByLabel('Level name', { exact: true }).fill('Edited before finalize');
  await flushEdits(page);
  await share(page);
  await page.getByRole('button', { name: 'Finalize', exact: true }).click();
  await expect(page.locator('.ed-toast-success', { hasText: 'Finalize complete.' })).toBeVisible();
  expect(finalizes).toBe(1);
});
