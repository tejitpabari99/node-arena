import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

let server: ViteDevServer, browser: Browser, page: Page;
const errors: string[] = [];
const domExpect = browserExpect.configure({ timeout: 1500 });
beforeAll(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-test-editor-toasts', server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'toasts-fixture', configureServer(s) {
    s.middlewares.use('/__toasts', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(await s.transformIndexHtml('/__toasts', '<!doctype html><html><body><main id="app"></main><script type="module" src="/test/editor/toasts-fixture.tsx"></script></body></html>'));
    });
  } }] });
  await server.listen();
  await server.warmupRequest('/test/editor/toasts-fixture.tsx');
  await server.waitForRequestsIdle();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  page.setDefaultTimeout(1500);
  page.on('pageerror', error => errors.push(error.message));
}, 30000);
afterAll(async () => { await browser?.close(); await server?.close(); });
const reset = async () => { await page.goto(server.resolvedUrls!.local[0] + '__toasts'); };

it('keeps existing banners and dismissible error hooks, renders action and manual dismissal', async () => {
  await reset();
  await domExpect(page.getByTestId('script-removal-banner')).toHaveText('Scripts removed');
  await domExpect(page.getByTestId('error-toast')).toHaveAttribute('role', 'alert');
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await domExpect(page.getByTestId('error-toast')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add first' }).click();
  const toast = page.getByTestId('first-toast');
  await domExpect(toast).toContainText('Notice first');
  await domExpect(toast).toHaveAttribute('role', 'status');
  await toast.getByRole('button', { name: 'Details' }).click();
  await domExpect(page.getByTestId('actions')).toHaveText('1');
  await page.mouse.move(0, 0);
  const colors = await toast.getByRole('button', { name: 'Details' }).evaluate(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el.parentElement!).backgroundColor, z: getComputedStyle(el.closest('.ed-toasts')!).zIndex }));
  expect(colors).toEqual({ color: 'rgb(231, 239, 252)', background: 'rgb(17, 24, 39)', z: '15' });
  await toast.getByRole('button', { name: 'Dismiss notice' }).click();
  await domExpect(toast).toHaveCount(0);
  await domExpect(page.getByTestId('dismissed')).toHaveText('first');
  await domExpect(page.getByTestId('script-removal-banner')).toBeVisible();
});
it('dismisses each notice exactly 8 seconds after insertion across parent renders', async () => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:10Z'));
  await reset();
  await page.getByRole('button', { name: 'Add first' }).click();
  await domExpect(page.getByTestId('first-toast')).toBeVisible();
  await page.clock.runFor(4000);
  await page.getByRole('button', { name: 'Add second' }).click();
  await domExpect(page.getByTestId('second-toast')).toHaveAttribute('role', 'alert');
  await page.clock.runFor(3999);
  await domExpect(page.getByTestId('first-toast')).toBeVisible();
  await domExpect(page.getByTestId('dismissed')).toBeEmpty();
  await page.clock.runFor(1);
  await domExpect(page.getByTestId('first-toast')).toHaveCount(0);
  await domExpect(page.getByTestId('second-toast')).toBeVisible();
  await page.clock.runFor(4000);
  await domExpect(page.getByTestId('second-toast')).toHaveCount(0);
  await domExpect(page.getByTestId('dismissed')).toHaveText('first,second');
});
it('cleans timers when notices are removed or the toast stack unmounts', async () => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:10Z'));
  await reset();
  await page.getByRole('button', { name: 'Add first' }).click();
  await domExpect(page.getByTestId('first-toast')).toBeVisible();
  await page.getByRole('button', { name: 'Remove notices' }).click();
  await domExpect(page.getByTestId('first-toast')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add second' }).click();
  await domExpect(page.getByTestId('second-toast')).toBeVisible();
  await page.getByRole('button', { name: 'Toggle stack' }).click();
  await domExpect(page.getByTestId('second-toast')).toHaveCount(0);
  await page.clock.runFor(8000);
  await domExpect(page.getByTestId('dismissed')).toBeEmpty();
  expect(errors).toEqual([]);
});
