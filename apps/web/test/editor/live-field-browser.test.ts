import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
let server: ViteDevServer, browser: Browser, page: Page;
const domExpect = browserExpect.configure({ timeout: 2000 });
beforeAll(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-test-live-field', server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'live-field-fixture', configureServer(s) {
    s.middlewares.use('/__live-field', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(await s.transformIndexHtml('/__live-field', '<!doctype html><html><body><main id="app"></main><script type="module" src="/test/editor/live-field-fixture.tsx"></script></body></html>'));
    });
  } }] });
  await server.listen();
  browser = await chromium.launch({ headless: true }); page = await browser.newPage();
}, 30000);
afterAll(async () => { await browser?.close(); await server?.close(); });
const reset = async () => { await page.goto(server.resolvedUrls!.local[0] + '__live-field'); };
it('connects invalid text to an inline error and flushes valid text on Enter and blur', async () => {
  await reset();
  const input = page.getByRole('textbox', { name: 'Name' }), doc = page.getByTestId('document');
  const initial = await doc.textContent();
  await input.fill(''); await input.press('Enter');
  await domExpect(input).toHaveAttribute('aria-invalid', 'true');
  await domExpect(page.getByRole('alert')).toHaveText('Name is required');
  expect(await input.getAttribute('aria-describedby')).toBe(await page.getByRole('alert').getAttribute('id'));
  await domExpect(doc).toHaveText(initial!); await domExpect(input).toHaveValue('');
  await input.fill('First'); await input.press('Enter');
  await domExpect(doc).toHaveText('First');
  await input.fill('Second'); await input.blur();
  await domExpect(doc).toHaveText('Second'); await domExpect(page.getByTestId('past')).toHaveText('2');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await domExpect(input).toHaveValue('First');
  await domExpect(input).not.toHaveAttribute('aria-invalid');
});
it('flushes pending text on selection change and unmount without waiting for debounce', async () => {
  await reset();
  const input = page.getByRole('textbox', { name: 'Name' });
  await input.fill('Selection flush');
  // Programmatic click changes selection without triggering the input blur handler.
  await page.getByRole('button', { name: 'Switch selection' }).evaluate(button => (button as HTMLButtonElement).click());
  await domExpect(page.getByTestId('document')).toHaveText('Selection flush');
  await input.fill('Unmount flush');
  await page.getByRole('button', { name: 'Unmount' }).evaluate(button => (button as HTMLButtonElement).click());
  await domExpect(page.getByTestId('document')).toHaveText('Unmount flush');
  await domExpect(page.getByTestId('past')).toHaveText('2');
});
