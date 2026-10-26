import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

let server: ViteDevServer, browser: Browser, page: Page;
const errors: string[] = [];
const domExpect = browserExpect.configure({ timeout: 1500 });
beforeAll(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-test-editor-menu', server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'menu-fixture', configureServer(s) {
    s.middlewares.use('/__menu', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(await s.transformIndexHtml('/__menu', '<!doctype html><html><body><main id="app"></main><script type="module" src="/test/editor/menu-fixture.tsx"></script></body></html>'));
    });
  } }] });
  await server.listen();
  await server.warmupRequest('/test/editor/menu-fixture.tsx');
  await server.waitForRequestsIdle();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  page.setDefaultTimeout(1500);
  page.on('pageerror', error => errors.push(error.message));
}, 30000);
afterAll(async () => { await browser?.close(); await server?.close(); });
const reset = async () => { await page.goto(server.resolvedUrls!.local[0] + '__menu'); };

it('opens and toggles a labelled menu, exposes disabled items and keyboard hints', async () => {
  await reset();
  const trigger = page.getByRole('button', { name: 'File', exact: true });
  await domExpect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  await domExpect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await domExpect(page.getByRole('menu', { name: 'File' })).toBeVisible();
  await domExpect(trigger).toHaveAttribute('aria-expanded', 'true');
  await domExpect(page.getByRole('menuitem', { name: 'Disabled' })).toBeDisabled();
  await domExpect(page.locator('.ed-menu-kbd')).toHaveText('Ctrl+Z');
  await domExpect(page.getByRole('separator')).toHaveCount(1);
  await trigger.click();
  await domExpect(page.getByRole('menu')).toHaveCount(0);
  await domExpect(page.getByRole('button', { name: 'Locked' })).toBeDisabled();
});
it('roves with Up/Down, wraps past disabled items, activates with Enter and Space', async () => {
  await reset();
  const trigger = page.getByRole('button', { name: 'File', exact: true });
  await trigger.focus(); await page.keyboard.press('ArrowDown');
  await domExpect(page.getByRole('menuitem', { name: 'Create' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await domExpect(page.getByRole('menuitem', { name: 'Undo' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await domExpect(page.getByRole('menuitem', { name: 'Create' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await domExpect(page.getByRole('menuitem', { name: 'Redo' })).toBeFocused();
  await page.keyboard.press('Enter');
  await domExpect(page.getByTestId('selected')).toHaveText('redo');
  await domExpect(page.getByRole('menu')).toHaveCount(0);
  await trigger.focus(); await page.keyboard.press('Space');
  await domExpect(page.getByRole('menuitem', { name: 'Create' })).toBeFocused();
  await page.keyboard.press('Space');
  await domExpect(page.getByTestId('selected')).toHaveText('create');
  await domExpect(page.getByRole('menu')).toHaveCount(0);
});
it('Escape closes and returns focus to the trigger', async () => {
  await reset(); await page.getByRole('button', { name: 'File', exact: true }).click();
  await domExpect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await domExpect(page.getByRole('menu')).toHaveCount(0);
  await domExpect(page.getByRole('button', { name: 'File', exact: true })).toBeFocused();
});
it('outside pointer and Tab close without stealing the new focus', async () => {
  await reset(); const trigger = page.getByRole('button', { name: 'File', exact: true });
  await trigger.click(); await page.getByRole('button', { name: 'Outside', exact: true }).click();
  await domExpect(page.getByRole('menu')).toHaveCount(0);
  await domExpect(page.getByRole('button', { name: 'Outside', exact: true })).toBeFocused();
  await trigger.click(); await page.keyboard.press('Tab');
  await domExpect(page.getByRole('menu')).toHaveCount(0);
  await domExpect(page.getByRole('button', { name: 'Outside', exact: true })).toBeFocused();
  await trigger.click(); await page.keyboard.press('Shift+Tab');
  await domExpect(page.getByRole('menu')).toHaveCount(0);
  await domExpect(trigger).toBeFocused();
});
it('layered surfaces dismiss only the enabled topmost Escape handler and restore each trigger', async () => {
  await reset(); await page.getByRole('button', { name: 'Parent', exact: true }).click();
  await page.getByRole('button', { name: 'Child', exact: true }).click();
  await page.getByRole('button', { name: 'Child content' }).focus();
  await page.keyboard.press('Escape');
  await domExpect(page.getByRole('dialog', { name: 'Child surface' })).toHaveCount(0);
  await domExpect(page.getByRole('dialog', { name: 'Parent surface' })).toBeVisible();
  await domExpect(page.getByRole('button', { name: 'Child', exact: true })).toBeFocused();
  await domExpect(page.getByTestId('dismiss-reason')).toHaveText('escape');
  await page.keyboard.press('Escape');
  await domExpect(page.getByRole('dialog')).toHaveCount(0);
  await domExpect(page.getByRole('button', { name: 'Parent', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});
