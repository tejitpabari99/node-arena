import { expect, test, type Locator, type Page } from '@playwright/test';
import { openFile, save, share } from './editor-helpers.js';

async function expectAboveCanvasAndOutsideControls(page: Page, surface: Locator) {
  const box = (await surface.boundingBox())!, controls = (await page.getByTestId('canvas-controls').boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(1440 - 56);
  expect(box.x + box.width).toBeLessThan(controls.x);
  expect(await surface.evaluate(element => {
    const box = element.getBoundingClientRect(), canvas = document.querySelector('.ed-canvas')!.getBoundingClientRect();
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    return x >= canvas.left && x < canvas.right && y >= canvas.top && y < canvas.bottom && element.contains(document.elementFromPoint(x, y));
  })).toBe(true);
}

test.beforeEach(async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev editor');
  await page.route('**/__editor/status', route => route.fulfill({ json: { unfinalized: true, output: '' } }));
});

test('minimal bar, File keyboard navigation and exclusive Share preserve the control gutter', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/editor.html?template=levelview-1');
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  await expect(page.locator('.ed-top > button, .ed-top > span > button')).toHaveCount(4);
  await expect(page.getByTestId('save-chip')).toHaveJSProperty('tagName', 'SPAN');
  await expect(page.getByTestId('level-name')).toHaveCount(0);
  await page.getByTestId('file-menu-button').focus(); await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('menu-create')).toBeFocused();
  await expect(page.getByTestId('menu-duplicate')).toBeDisabled();
  await page.keyboard.press('ArrowDown'); await expect(page.getByTestId('menu-open')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.getByTestId('file-menu-button')).toBeFocused();
  await page.getByTestId('file-menu-button').click(); await share(page);
  await expect(page.getByTestId('file-menu')).toHaveCount(0);
  const panel = (await page.getByTestId('share-panel').boundingBox())!, controls = (await page.getByTestId('canvas-controls').boundingBox())!;
  expect(panel.x + panel.width).toBeLessThanOrEqual(1440 - 56);
  expect(panel.x + panel.width).toBeLessThan(controls.x);
  await expectAboveCanvasAndOutsideControls(page, page.getByTestId('share-panel'));
  await page.keyboard.press('Escape'); await expect(page.getByTestId('share-button')).toBeFocused();
});

test('dirty Create preserves form on Cancel; failed Save stays; Discard replaces with one modal', async ({ page }) => {
  let saves = 0;
  await page.route('**/__editor/save', route => { saves++; return route.fulfill({ status: 500, json: { error: 'disk full' } }); });
  await page.goto('/editor.html?template=levelview-1');
  await openFile(page, 'create'); await page.getByLabel('New level id').fill('na-safe-create');
  await page.getByTestId('create-confirm').click();
  await expect(page.getByRole('dialog', { includeHidden: false })).toHaveCount(1);
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByLabel('New level id')).toHaveValue('na-safe-create');
  await page.getByTestId('create-confirm').click(); await page.getByTestId('confirm-save').click();
  await expect.poll(() => saves).toBe(1);
  await expect(page.getByTestId('discard-confirm')).toContainText('disk full');
  await page.getByTestId('confirm-discard').click();
  await expect(page.getByLabel('Level id', { exact: true })).toHaveText('na-safe-create');
});

test('Duplicate requires a saved document, aborts on failed save then duplicates current saved edits at 0.0.1', async ({ page }) => {
  let fail = false, duplicates = 0, saved: Record<string, unknown>;
  await page.route('**/__editor/save', async route => {
    if (fail) return route.fulfill({ status: 500, json: { error: 'offline' } });
    saved = { ...route.request().postDataJSON().level, editorVersion: '0.0.7' };
    return route.fulfill({ json: { level: saved, warnings: [] } });
  });
  await page.route('**/__editor/duplicate', route => { duplicates++; return route.fulfill({ json: { level: { ...saved, id: `${saved.id}-copy`, editorVersion: '0.0.1' }, warnings: [] } }); });
  await page.goto('/editor.html?template=levelview-1'); await save(page);
  await expect(page.getByTestId('save-chip')).toHaveText('✓ Saved');
  await page.getByLabel('Level name', { exact: true }).fill('Edited duplicate'); await page.getByRole('button', { name: 'Apply level properties' }).click();
  fail = true;
  await page.getByTestId('file-menu-button').click(); await page.getByTestId('menu-duplicate').click();
  await expect(page.getByTestId('confirm-discard')).toHaveCount(0);
  await expect(page.getByTestId('confirm-save')).toHaveText('Save & duplicate');
  await page.getByTestId('confirm-save').click(); await expect(page.getByTestId('save-message')).toHaveText('offline');
  expect(duplicates).toBe(0);
  fail = false; await page.getByTestId('confirm-save').click();
  await expect.poll(() => duplicates).toBe(1);
  await expect(page.getByLabel('Level name', { exact: true })).toHaveValue('Edited duplicate');
  await share(page); await expect(page.getByTestId('editor-version')).toHaveText('Version 0.0.1');
});

test('Check completion toast reopens Share and left flyout; Escape closes topmost without duplicate notices', async ({ page }) => {
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/__editor/solvable', async route => { await held; await route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'result', report: { totalWins: 2, runs: 3, ok: true } }) + '\n' }); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/editor.html?template=levelview-1'); await share(page);
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await page.keyboard.press('Escape'); release();
  await expect(page.getByTestId('check-toast')).toContainText('Check: AI won 2/3');
  await expect(page.getByTestId('share-panel')).toHaveCount(0);
  await page.getByTestId('check-toast').getByRole('button', { name: 'Details' }).click();
  const flyout = page.getByTestId('check-popover'), panel = page.getByTestId('share-panel');
  await expect(flyout).toContainText('Proxy wins: 2/3');
  const f = (await flyout.boundingBox())!, p = (await panel.boundingBox())!;
  expect(f.x + f.width).toBeLessThan(p.x);
  await expectAboveCanvasAndOutsideControls(page, panel);
  await expectAboveCanvasAndOutsideControls(page, flyout);
  await page.keyboard.press('Escape'); await expect(flyout).toHaveCount(0); await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Details' })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('check-toast')).toHaveCount(1);
});

test('Back failure keeps editing, Cancel keeps native guard, approved Discard leaves without native prompt', async ({ page }) => {
  let prompts = 0;
  page.on('dialog', dialog => { prompts++; void dialog.dismiss(); });
  await page.route('**/__editor/save', route => route.fulfill({ status: 500, json: { error: 'offline' } }));
  await page.goto('/editor.html?template=levelview-1');
  await page.getByTestId('back').click(); await page.getByTestId('confirm-save').click();
  await expect(page.getByTestId('save-message')).toHaveText('offline');
  await expect(page).toHaveURL(/editor.html/); await expect(page.getByTestId('discard-confirm')).toBeVisible();
  await page.getByTestId('confirm-cancel').click();
  expect(await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })).toBe(true);
  await page.getByTestId('back').click(); await page.getByTestId('confirm-discard').click();
  await expect(page).toHaveURL(/\/$/); expect(prompts).toBe(0);
});

test('Back Save and leave waits for a successful save; clean Back leaves directly', async ({ page }) => {
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/__editor/save', async route => { await held; await route.fulfill({ json: { level: { ...route.request().postDataJSON().level, editorVersion: '0.0.1' }, warnings: [] } }); });
  await page.goto('/editor.html?template=levelview-1'); await page.getByTestId('back').click();
  await page.getByTestId('confirm-save').click(); await expect(page.getByTestId('confirm-save')).toBeDisabled();
  await expect(page).toHaveURL(/editor.html/); release(); await expect(page).toHaveURL(/\/$/);
  await page.goto('/editor.html?level=na-trial'); await page.getByTestId('back').click();
  await expect(page).toHaveURL(/\/$/);
});

test('Open reads before confirmation, preserves read errors, and saves before installing target', async ({ page }) => {
  let readFails = true, saves = 0;
  await page.route('**/__editor/level/na-trial', route => readFails ? route.fulfill({ status: 500, json: { error: 'read unavailable' } }) : route.continue());
  await page.route('**/__editor/save', route => { saves++; return route.fulfill({ json: { level: route.request().postDataJSON().level, warnings: [] } }); });
  await page.goto('/editor.html?template=levelview-1'); await openFile(page, 'open'); await page.getByTestId('open-confirm').click();
  await expect(page.getByRole('alert')).toHaveText('read unavailable'); await expect(page.getByTestId('discard-confirm')).toHaveCount(0);
  readFails = false; await page.getByTestId('open-confirm').click(); await expect(page.getByTestId('discard-confirm')).toBeVisible();
  await page.getByTestId('confirm-save').click(); await expect(page.getByLabel('Level id', { exact: true })).toHaveText('na-trial');
  expect(saves).toBe(1); await expect(page.getByTestId('save-chip')).toHaveText('✓ Saved');
});
