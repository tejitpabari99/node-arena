import { expect, test, type Page } from '@playwright/test';
import type { LevelDoc } from '../src/editor/document.js';
import { openFile, save, share } from './editor-helpers.js';

async function openFixture(page: Page) {
  const source = await (await page.request.get('/__editor/level/na-trial')).json() as LevelDoc;
  const original = { ...source, name: 'Original on disk', editorVersion: '0.0.1' };
  const other = { ...source, id: 'na-open-other', name: 'Other on disk', editorVersion: '0.0.4' };
  const disk = new Map([[original.id, original], [other.id, other]]);
  const writes: LevelDoc[] = [];
  await page.route('**/__editor/levels', route => route.fulfill({ json: [...disk.values()].map(({ id, name }) => ({ id, name })) }));
  await page.route('**/__editor/level/*', route => route.fulfill({ json: disk.get(route.request().url().split('/').at(-1)!) }));
  await page.route('**/__editor/status', route => route.fulfill({ json: { unfinalized: true, output: '' } }));
  await page.route('**/__editor/save', route => {
    const posted = route.request().postDataJSON().level as LevelDoc;
    const level = { ...posted, editorVersion: `0.0.${writes.length + 2}` };
    writes.push(structuredClone(level)); disk.set(level.id, level);
    return route.fulfill({ json: { level, warnings: [], changed: true } });
  });
  await page.goto('/editor.html?level=na-trial');
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  return { original, other, disk, writes };
}
async function editCurrent(page: Page) {
  await page.getByLabel('Level name', { exact: true }).fill('Saved during Open');
  await page.getByLabel('Time limit (seconds)').fill('120');
  await page.getByRole('button', { name: 'Apply level properties' }).click();
  await expect(page.getByTestId('save-chip')).toHaveText('Unsaved');
}
async function requestCurrent(page: Page) {
  await openFile(page, 'open');
  await expect(page.getByRole('combobox', { name: 'Open level', exact: true })).toHaveValue('na-trial');
  await page.getByTestId('open-confirm').click();
  await expect(page.getByTestId('discard-confirm')).toBeVisible();
}

test.beforeEach(() => test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev editor'));

test('Open current + Save installs the saved response and later saves preserve previous edits', async ({ page }) => {
  const { writes } = await openFixture(page);
  await editCurrent(page); await requestCurrent(page);
  await page.getByTestId('confirm-save').click();
  await expect(page.getByLabel('Level name', { exact: true })).toHaveValue('Saved during Open');
  await expect(page.getByLabel('Time limit (seconds)')).toHaveValue('120');
  await expect(page.getByTestId('save-chip')).toHaveText('✓ Saved');
  await share(page); await expect(page.getByTestId('editor-version')).toHaveText('Version 0.0.2');
  expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(false);
  await page.getByLabel('Level theme', { exact: true }).selectOption('snow');
  await page.getByRole('button', { name: 'Apply level properties' }).click();
  await save(page); await expect(page.getByTestId('save-chip')).toHaveText('✓ Saved');
  expect(writes).toHaveLength(2);
  expect(writes[1]).toMatchObject({ name: 'Saved during Open', timeLimitSec: 120, theme: 'snow', editorVersion: '0.0.3' });
});

test('Open current + Discard installs the original disk snapshot without saving edits', async ({ page }) => {
  const { original, writes } = await openFixture(page);
  await editCurrent(page); await requestCurrent(page); await page.getByTestId('confirm-discard').click();
  await expect(page.getByLabel('Level name', { exact: true })).toHaveValue(original.name);
  await expect(page.getByTestId('save-chip')).toHaveText('✓ Saved');
  await share(page); await expect(page.getByTestId('editor-version')).toHaveText('Version 0.0.1');
  expect(writes).toHaveLength(0);
});

test('Open another level + Save saves current edits and then installs the requested target', async ({ page }) => {
  const { other, disk, writes } = await openFixture(page);
  await editCurrent(page); await openFile(page, 'open');
  await page.getByRole('combobox', { name: 'Open level', exact: true }).selectOption(other.id);
  await page.getByTestId('open-confirm').click(); await page.getByTestId('confirm-save').click();
  await expect(page.getByLabel('Level id', { exact: true })).toHaveText(other.id);
  await expect(page.getByLabel('Level name', { exact: true })).toHaveValue(other.name);
  await expect(page.getByTestId('save-chip')).toHaveText('✓ Saved');
  await share(page); await expect(page.getByTestId('editor-version')).toHaveText('Version 0.0.4');
  expect(writes).toHaveLength(1);
  expect(disk.get('na-trial')).toMatchObject({ name: 'Saved during Open', timeLimitSec: 120, editorVersion: '0.0.2' });
});
