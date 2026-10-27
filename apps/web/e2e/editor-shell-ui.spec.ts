import { undo as editorUndo, save as editorSave, openFile, share, openCopied } from './editor-helpers.js';
import { test, expect, type Page, type Route } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { acceptDialogs } from './helpers.js';

const development = process.env.WEB_TEST_SERVER === 'dev';
declare global { interface Window { __editorSave?: (source?: 'manual' | 'auto') => Promise<void> } }

/** Echo the posted level back, like a server that normalizes nothing; optionally held until `release`. */
async function mockSave(page: Page, hold?: Promise<void>) {
  const posted: unknown[] = [];
  await page.route('**/__editor/save', async (route: Route) => {
    const body = route.request().postDataJSON() as { level: unknown };
    posted.push(body.level);
    if (hold) await hold;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ level: body.level, warnings: [] }) });
  });
  return posted;
}
async function placeBuilding(page: Page, at = .45) {
  const box = (await page.getByLabel('Edit viewport').boundingBox())!, item = page.getByRole('button', { name: 'Place house-wt1', exact: true }), source = (await item.boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width * at, box.y + box.height * at, { steps: 8 }); await page.mouse.up();
}

test('chip walks Unsaved, Saving, Saved and back to Unsaved on edit', async ({ page }) => {
  test.skip(!development, 'Editor API is dev-only');
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  await mockSave(page, hold);
  await openCopied(page);
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  const chip = page.getByTestId('save-chip');
  await expect(chip).toHaveText('Unsaved');
  await editorSave(page);
  await expect(chip).toHaveText('Saving…');
  release();
  await expect(chip).toHaveText('✓ Saved');
  const before = Number(await page.locator('.ed-shell').getAttribute('data-buildings'));
  await placeBuilding(page);
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', String(before + 1));
  await expect(chip).toHaveText('Unsaved');
  await editorUndo(page);
  await expect(chip).toHaveText('✓ Saved');
  await page.setViewportSize({ width: 1280, height: 720 });
  const dir = process.env.SHOT_DIR; if (dir) { mkdirSync(dir, { recursive: true }); await page.locator('.ed-top').screenshot({ path: `${dir}/topbar-1280x720.png` }); }
});

test('blank document Save lists issues in the status popover; left panel exposes id', async ({ page }) => {
  test.skip(!development, 'Editor API is dev-only');
  await page.goto('/editor.html');
  await page.getByLabel('New level id').fill('na-chip-blank');
  await page.getByTestId('create-confirm').click();
  const chip = page.getByTestId('save-chip');
  await expect(page.getByLabel('Level id', { exact: true })).toHaveText('na-chip-blank');
  await expect(chip).toHaveText('Unsaved');
  await editorSave(page);
  await expect(chip).toHaveText(/^\d+ issues$/);
  await expect(page.getByTestId('save-popover')).toBeVisible();
  await expect(page.getByTestId('save-popover')).toContainText('Add at least one building');
  await expect(page.getByTestId('save-popover').locator('li[data-item]').first()).toBeVisible();
});

test('an edit made during a stalled save survives and the chip stays Unsaved', async ({ page }) => {
  test.skip(!development, 'Editor API is dev-only');
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  const posted = await mockSave(page, hold);
  await openCopied(page);
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  const before = Number(await page.locator('.ed-shell').getAttribute('data-buildings'));
  const chip = page.getByTestId('save-chip');
  void page.evaluate(() => window.__editorSave!('auto'));
  await expect(chip).toHaveText('Saving…');
  expect(posted.length).toBe(1);
  await placeBuilding(page);
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', String(before + 1));
  release();
  await expect(chip).toHaveText('Unsaved');
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', String(before + 1));
  await editorUndo(page);
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', String(before));
  await expect(chip).toHaveText('✓ Saved');
});

async function openClocked(page: Page) {
  await page.clock.install();
  await openCopied(page);
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
}

test('new document is never autosaved before a manual Save, even when edited', async ({ page }) => {
  test.skip(!development, 'Editor API is dev-only');
  const posted = await mockSave(page);
  await openClocked(page);
  await placeBuilding(page);
  await expect(page.getByTestId('save-chip')).toHaveText('Unsaved');
  await page.clock.runFor(30100);
  expect(posted.length).toBe(0);
});

test('after a manual Save an edit waits through 5s and 15s, autosaves at 30s, and returns to Saved', async ({ page }) => {
  test.skip(!development, 'Editor API is dev-only');
  const posted = await mockSave(page);
  await openClocked(page);
  await editorSave(page);
  await expect(page.getByTestId('save-chip')).toHaveText('✓ Saved');
  expect(posted.length).toBe(1);
  await page.clock.runFor(30100);
  expect(posted.length).toBe(1);
  await placeBuilding(page);
  await expect(page.getByTestId('save-chip')).toHaveText('Unsaved');
  await page.clock.runFor(5000);
  expect(posted.length).toBe(1);
  await expect(page.getByTestId('save-chip')).toHaveText('Unsaved');
  await page.clock.runFor(10000);
  expect(posted.length).toBe(1);
  await expect(page.getByTestId('save-chip')).toHaveText('Unsaved');
  await page.clock.runFor(15100);
  await expect(page.getByTestId('save-chip')).toHaveText('✓ Saved');
  expect(posted.length).toBe(2);
  await page.clock.runFor(30100);
  expect(posted.length).toBe(2);
});

test('a failed autosave shows the error chip and is not retried until the next edit', async ({ page }) => {
  test.skip(!development, 'Editor API is dev-only');
  let fail = false, calls = 0;
  await page.route('**/__editor/save', async route => {
    calls++;
    const body = route.request().postDataJSON() as { level: unknown };
    if (fail) await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'disk full' }) });
    else await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ level: body.level, warnings: [] }) });
  });
  await openClocked(page);
  await editorSave(page);
  await expect(page.getByTestId('save-chip')).toHaveText('✓ Saved');
  fail = true;
  await placeBuilding(page);
  await page.clock.runFor(30100);
  await expect(page.getByTestId('save-chip')).toHaveText(/Can't save/);
  expect(calls).toBe(2);
  await page.clock.runFor(60100);
  expect(calls).toBe(2);
  fail = false;
  await placeBuilding(page, .6);
  await page.clock.runFor(30100);
  await expect(page.getByTestId('save-chip')).toHaveText('✓ Saved');
  expect(calls).toBe(3);
});

test('a 409 job-running autosave response is transient and retried on the next tick', async ({ page }) => {
  test.skip(!development, 'Editor API is dev-only');
  let calls = 0;
  await page.route('**/__editor/save', async route => {
    calls++;
    const body = route.request().postDataJSON() as { level: unknown };
    if (calls === 2) await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'job already running' }) });
    else await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ level: body.level, warnings: [] }) });
  });
  await openClocked(page);
  await editorSave(page);
  await expect(page.getByTestId('save-chip')).toHaveText('✓ Saved');
  await placeBuilding(page);
  await page.clock.runFor(30100);
  await expect.poll(() => calls).toBe(2);
  await expect(page.getByTestId('save-chip')).not.toHaveText(/Can't save/);
  await page.clock.runFor(30100);
  await expect(page.getByTestId('save-chip')).toHaveText('✓ Saved');
  expect(calls).toBe(3);
});

test('no autosave while Check or Finalize runs; autosave never hits Finalize', async ({ page }) => {
  test.skip(!development, 'Editor API is dev-only');
  const posted = await mockSave(page);
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  let finalizeCalls = 0, checkCalls = 0;
  await page.route('**/__editor/solvable', async route => { checkCalls++; await hold; await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'stub' }) }); });
  await page.route('**/__editor/finalize', async route => { finalizeCalls++; await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'stub' }) }); });
  await openClocked(page);
  await editorSave(page);
  await expect(page.getByTestId('save-chip')).toHaveText('✓ Saved');
  await placeBuilding(page);
  await share(page);
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect.poll(() => checkCalls).toBe(1);
  const before = posted.length;
  await page.clock.runFor(60100);
  expect(posted.length).toBe(before);
  release();
  await expect(page.getByRole('button', { name: 'Check', exact: true })).toBeEnabled();
  await page.clock.runFor(30100);
  await expect.poll(() => posted.length).toBe(before + 1);
  expect(finalizeCalls).toBe(0);
});

test('beforeunload guard is registered only while the document is dirty', async ({ page }) => {
  test.skip(!development, 'Editor API is dev-only');
  acceptDialogs(page);
  await mockSave(page);
  const guarded = () => page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
  await openCopied(page);
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  expect(await guarded()).toBe(true);
  await editorSave(page);
  await expect(page.getByTestId('save-chip')).toHaveText('✓ Saved');
  expect(await guarded()).toBe(false);
  await placeBuilding(page);
  await expect(page.getByTestId('save-chip')).toHaveText('Unsaved');
  await expect.poll(guarded).toBe(true);
});

test('start card offers blank, copy and open; bad and existing ids alert', async ({ page }) => {
  test.skip(!development, 'Editor API is dev-only');
  acceptDialogs(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/editor.html');
  const dialog = page.locator('.ed-start-card');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('file-menu-button')).toHaveCount(0);
  await expect(page.locator('.ed-top')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('New level id')).toHaveValue(/^na-custom-\d+$/);
  const dir = process.env.SHOT_DIR; if (dir) { mkdirSync(dir, { recursive: true }); await page.screenshot({ path: `${dir}/file-modal-standalone-1280x720.png` }); }
  await page.getByLabel('New level id').fill('bad id');
  await page.getByTestId('create-confirm').click();
  await expect(dialog.getByRole('alert')).toContainText('na-');
  await page.getByLabel('New level id').fill('na-trial');
  await page.getByTestId('create-confirm').click();
  await expect(dialog.getByRole('alert')).toContainText('already exists');
  await page.getByLabel('New level id').fill('na-modal-blank');
  await page.getByTestId('create-confirm').click();
  await expect(page.getByLabel('Level id', { exact: true })).toHaveText('na-modal-blank');
  await expect(dialog).toHaveCount(0);
  await page.goto('/editor.html');
  await page.getByLabel('Copy existing level', { exact: true }).selectOption('levelview-1');
  await page.getByTestId('create-confirm').click();
  await expect(page.getByLabel('Level id', { exact: true })).toHaveText(/^na-custom-\d+$/);
  await page.goto('/editor.html');
  await page.getByLabel('Open level').selectOption('na-trial');
  await page.getByRole('button', { name: 'Open level', exact: true }).click();
  await expect(page.getByLabel('Level id', { exact: true })).toHaveText('na-trial');
  await expect(page.getByTestId('save-chip')).toHaveText('✓ Saved');
});

test('file dialog over an open document: dirty replace prompts, Cancel keeps, Discard replaces, Esc dismisses', async ({ page }) => {
  test.skip(!development, 'Editor API is dev-only');
  await page.setViewportSize({ width: 1280, height: 720 });
  await openCopied(page);
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  const name = page.getByLabel('Level id', { exact: true }), original = await name.textContent();
  await openFile(page, 'create');
  await expect(page.getByRole('dialog')).toBeVisible();
  const dir = process.env.SHOT_DIR; if (dir) { mkdirSync(dir, { recursive: true }); await page.screenshot({ path: `${dir}/file-modal-dismissible-1280x720.png` }); }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(name).toHaveText(original!);
  await openFile(page, 'create');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openFile(page, 'create');
  await page.getByLabel('New level id').fill('na-discard-test');
  await page.getByTestId('create-confirm').click();
  await expect(page.getByTestId('discard-confirm')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('discard-confirm')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(name).toHaveText(original!);
  await page.getByTestId('create-confirm').click();
  await page.getByTestId('confirm-discard').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(name).toHaveText('na-discard-test');
});

test('manifest load failure shows a dismissible alert toast', async ({ page }) => {
  test.skip(!development, 'Editor API is dev-only');
  await page.route('**/manifest.json', route => route.fulfill({ status: 500, body: 'nope' }));
  await page.goto('/editor.html');
  await page.getByLabel('New level id').fill('na-toast-manifest');
  await page.getByTestId('create-confirm').click();
  const toast = page.locator('.ed-canvas').getByTestId('error-toast');
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute('role', 'alert');
  await toast.getByRole('button', { name: 'Dismiss error' }).click();
  await expect(toast).toHaveCount(0);
});
