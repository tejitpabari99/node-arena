import { test, expect, type Page } from '@playwright/test';
import { openCopied } from './editor-helpers.js';

// Records whether the app swallowed a keydown (defaultPrevented) by listening after its handlers.
async function watch(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __prevented: boolean[] };
    w.__prevented = [];
    window.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'c') w.__prevented.push(e.defaultPrevented); });
  });
}
const prevented = (page: Page) => page.evaluate(() => (window as unknown as { __prevented: boolean[] }).__prevented);

test.beforeEach(async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev-only editor');
  await openCopied(page);
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  await watch(page);
});

test('Ctrl+C with selected page text is not swallowed', async ({ page }) => {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid=viewport-status]')!;
    const r = document.createRange(); r.selectNodeContents(el);
    const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
  });
  await page.keyboard.press('Control+c');
  expect(await prevented(page)).toEqual([false]);
});

test('Ctrl+C in a text input is not swallowed and selects text', async ({ page }) => {
  const input = page.locator('.ed-shell input[type=text], .ed-shell input:not([type])').first();
  await input.focus();
  const text = await input.inputValue();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  expect(await prevented(page)).toEqual([false]);
  expect(await input.evaluate((e: HTMLInputElement) => e.value.slice(e.selectionStart!, e.selectionEnd!))).toBe(text);
});
