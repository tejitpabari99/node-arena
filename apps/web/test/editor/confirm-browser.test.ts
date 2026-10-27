import { expect, it } from 'vitest';
import { chromium, expect as browserExpect } from '@playwright/test';
import { createServer } from 'vite';

it('confirms dirty actions with accessible focus, cancellation, busy safety and save failure recovery in Chromium', async () => {
  const server = await createServer({ cacheDir: 'node_modules/.vite-test-confirm', server: { host: '127.0.0.1', port: 0 }, plugins: [{
    name: 'confirm-fixture', configureServer(s) {
      s.middlewares.use('/__confirm', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(await s.transformIndexHtml('/__confirm', '<!doctype html><html><body><div id="app"></div><script type="module" src="/test/editor/confirm-fixture.tsx"></script></body></html>'));
      });
    },
  }] });
  await server.listen();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(4000);
    await page.goto(server.resolvedUrls!.local[0] + '__confirm');
    const trigger = page.getByRole('button', { name: 'Open guarded action', exact: true });
    const duplicate = page.getByRole('button', { name: 'Duplicate guarded action' });
    const dialog = page.getByTestId('discard-confirm');
    const save = page.getByTestId('confirm-save');
    const discard = page.getByTestId('confirm-discard');
    const cancel = page.getByTestId('confirm-cancel');
    await trigger.click();
    await browserExpect(dialog).toHaveAttribute('role', 'dialog');
    await browserExpect(dialog).toHaveAttribute('aria-modal', 'true');
    await browserExpect(dialog).toHaveAccessibleName('Unsaved changes');
    await browserExpect(save).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await browserExpect(cancel).toBeFocused();
    await page.keyboard.press('Tab'); await browserExpect(save).toBeFocused();
    await page.keyboard.press('Tab'); await browserExpect(discard).toBeFocused();
    await page.keyboard.press('Escape'); await browserExpect(dialog).toHaveCount(0);
    await browserExpect(trigger).toBeFocused();
    await trigger.click(); await cancel.click(); await browserExpect(dialog).toHaveCount(0);
    await browserExpect(trigger).toBeFocused();
    await browserExpect(page.getByTestId('actions')).toHaveText('0');
    await trigger.click(); await discard.click(); await browserExpect(dialog).toHaveCount(0);
    await browserExpect(page.getByTestId('actions')).toHaveText('1');
    await browserExpect(page.getByTestId('saves')).toHaveText('0');
    await trigger.click(); await save.click();
    for (const button of [save, discard, cancel]) await browserExpect(button).toBeDisabled();
    await page.keyboard.press('Escape'); await browserExpect(dialog).toBeVisible();
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
    await browserExpect(page.getByTestId('actions')).toHaveText('1');
    await page.evaluate(() => Reflect.get(window, 'finishConfirmSave')(false));
    await browserExpect(save).toBeEnabled(); await browserExpect(dialog).toBeVisible();
    await browserExpect(page.getByRole('alert')).toHaveText('Save failed');
    await browserExpect(page.getByTestId('actions')).toHaveText('1');
    await save.click(); await page.evaluate(() => Reflect.get(window, 'finishConfirmSave')(true));
    await browserExpect(dialog).toHaveCount(0); await browserExpect(trigger).toBeFocused();
    await browserExpect(page.getByTestId('actions')).toHaveText('2');
    await duplicate.click(); await browserExpect(save).toHaveText('Save & duplicate');
    await browserExpect(discard).toHaveCount(0); await browserExpect(save).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await browserExpect(cancel).toBeFocused();
    await save.click(); await page.evaluate(() => Reflect.get(window, 'finishConfirmSave')(false));
    await browserExpect(dialog).toBeVisible(); await browserExpect(page.getByTestId('actions')).toHaveText('2');
    await cancel.click(); await browserExpect(dialog).toHaveCount(0); await browserExpect(duplicate).toBeFocused();
    await duplicate.click(); await save.click(); await page.evaluate(() => Reflect.get(window, 'finishConfirmSave')(true));
    await browserExpect(dialog).toHaveCount(0); await browserExpect(page.getByTestId('actions')).toHaveText('3');
    expect(errors).toEqual([]);
  } finally { await browser.close(); await server.close(); }
}, 60000);
