import { save as editorSave, openFile, openCopied, clearBuildings } from './editor-helpers.js';
import { test, expect as browserExpect, expect } from '@playwright/test';

const development = process.env.WEB_TEST_SERVER === 'dev';
/** Replacing a dirty document asks first; accept it when shown. */
async function discardIfAsked(page: import('@playwright/test').Page) {
  const discard = page.getByTestId('confirm-discard');
  if (await discard.waitFor({ timeout: 1500 }).then(() => true, () => false)) await discard.click();
}
test('starts blank drafts and copies without retaining source identity', async ({ page }) => {
  test.skip(!development, 'Editor filesystem API is dev-only');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/editor.html');
  await browserExpect(page.locator('.ed-start-card')).toBeVisible();
  await browserExpect(page.getByTestId('file-menu-button')).toHaveCount(0);
  await page.getByLabel('New level id').fill('bad-id');
  await page.getByTestId('create-confirm').click();
  await browserExpect(page.getByRole('alert')).toContainText('na-');
  await page.getByLabel('New level id').fill('na-blank');
  await page.getByLabel('Theme').selectOption('snow');
  await page.getByLabel('Size').selectOption('large');
  await page.getByTestId('create-confirm').click();
  await browserExpect(page.getByLabel('Level id', { exact: true })).toHaveText('na-blank');
  await browserExpect(page.getByLabel('Level theme', { exact: true })).toHaveValue('snow');
  await browserExpect(page.locator('.ed-shell')).toHaveAttribute('data-players', '2');
  await clearBuildings(page);
  await editorSave(page);
  await browserExpect(page.getByTestId('save-chip')).toHaveText(/^\d+ issues$/);
  await browserExpect(page.getByTestId('save-popover')).toContainText('Human has no building');
  await openFile(page, 'create');
  await page.getByLabel('Copy existing level', { exact: true }).selectOption('levelview-1');
  await page.getByLabel('New level id').fill('levelview-1');
  await page.getByTestId('create-confirm').click();
  await browserExpect(page.getByRole('dialog').getByRole('alert')).toContainText('new id');
  await page.getByLabel('New level id').fill('na-copy');
  await page.getByTestId('create-confirm').click();
  await discardIfAsked(page);
  await browserExpect(page.getByLabel('Level id', { exact: true })).toHaveText('na-copy');
  await browserExpect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', /^\d+$/);
  await openFile(page, 'open');
  await page.getByRole('dialog', { name: 'Open level', exact: true }).getByRole('combobox', { name: 'Open level', exact: true }).selectOption('na-trial');
  await page.getByRole('button', { name: 'Open level', exact: true }).click();
  await discardIfAsked(page);
  await browserExpect(page.getByLabel('Level id', { exact: true })).toHaveText('na-trial');
  await openFile(page, 'create');
  await page.getByLabel('Copy existing level', { exact: true }).selectOption('na-trial');
  await page.getByLabel('New level id').fill('na-trial');
  await page.getByTestId('create-confirm').click();
  await browserExpect(page.getByRole('dialog').getByRole('alert')).toContainText('new id');
  await page.getByLabel('New level id').fill('na-trial-copy');
  await page.getByTestId('create-confirm').click();
  await discardIfAsked(page);
  await browserExpect(page.getByLabel('Level id', { exact: true })).toHaveText('na-trial-copy');
  expect(errors).toEqual([]);
});

test('test-hooks preview includes the editor shell without filesystem middleware', async ({ page, request }) => {
  test.skip(development, 'Preview gate check');
  await page.goto('/editor.html');
  await expect(page.locator('.ed-start-card')).toBeVisible();
  const api = await request.get('/__editor/levels');
  expect(api.headers()['content-type']).not.toContain('application/json');
});

for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
  test(`shell has no page scroll, scrolling left panel and filling canvas at ${size.width}x${size.height}`, async ({ page }) => {
    test.skip(!development, 'Editor filesystem API is dev-only');
    await page.setViewportSize(size);
    await openCopied(page);
    await expect(page.getByTestId('viewport-status')).toContainText('Ready');
    const m = await page.evaluate(() => {
      const el = document.documentElement, left = document.querySelector('.ed-left')!, canvas = document.querySelector('.ed-canvas')!.getBoundingClientRect(), top = document.querySelector('.ed-top')!.getBoundingClientRect();
      return { sw: el.scrollWidth, sh: el.scrollHeight, cw: el.clientWidth, ch: el.clientHeight, leftOverflow: getComputedStyle(left).overflowY, leftW: left.getBoundingClientRect().width, topH: top.height, canvas: { x: canvas.x, y: canvas.y, w: canvas.width, h: canvas.height } };
    });
    expect(m.sw).toBeLessThanOrEqual(m.cw); expect(m.sh).toBeLessThanOrEqual(m.ch);
    expect(m.leftOverflow).toBe('auto'); expect(m.leftW).toBe(300); expect(m.topH).toBe(56);
    expect(m.canvas).toEqual({ x: 300, y: 56, w: size.width - 300, h: size.height - 56 });
    const host = await page.getByLabel('Edit viewport').boundingBox();
    expect(host!.width).toBeCloseTo(size.width - 300, 0); expect(host!.height).toBeCloseTo(size.height - 56, 0);
  });
}
