import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
vi.setConfig({ testTimeout: 20000 });
let server: ViteDevServer, browser: Browser, page: Page;
const errors: string[] = [];
const domExpect = browserExpect.configure({ timeout: 5000 });
beforeAll(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-test-editor-share', server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'share-fixture', configureServer(s) {
    s.middlewares.use('/__share', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(await s.transformIndexHtml('/__share', '<!doctype html><html><body style="margin:0"><main id="app"></main><script type="module" src="/test/editor/share-panel-fixture.tsx"></script></body></html>'));
    });
  } }] });
  await server.listen(); await server.warmupRequest('/test/editor/share-panel-fixture.tsx'); await server.waitForRequestsIdle();
  browser = await chromium.launch({ headless: true }); page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
}, 60000);
afterAll(async () => { await browser?.close(); await server?.close(); });
const reset = async () => { await page.goto(server.resolvedUrls!.local[0] + '__share'); };
const open = async () => { await page.getByTestId('share-button').click(); };
it('opens a 320px Share dialog below the top bar, clear of map controls; version tracks saved doc', async () => {
  await reset(); await open();
  const panel = page.getByTestId('share-panel'), trigger = page.getByTestId('share-button');
  await domExpect(panel).toHaveAttribute('role', 'dialog'); await domExpect(panel).toHaveAccessibleName('Share');
  await domExpect(trigger).toHaveAttribute('aria-expanded', 'true'); await domExpect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
  await domExpect(page.getByTestId('editor-version')).toHaveText('Version 0.0.0');
  const box = (await panel.boundingBox())!, button = (await trigger.boundingBox())!, controls = (await page.getByTestId('map-controls').boundingBox())!;
  expect(box.width).toBe(320); expect(box.y).toBeGreaterThanOrEqual(56); expect(box.x + box.width).toBeCloseTo(button.x + button.width, 0); expect(box.x + box.width).toBeLessThan(controls.x);
  expect(await panel.evaluate(el => getComputedStyle(el).zIndex)).toBe('5');
  await page.getByRole('button', { name: 'Saved doc', exact: true }).click(); await open(); await domExpect(page.getByTestId('editor-version')).toHaveText('Version 0.0.7');
});
it('Save calls manual; jobs show busy controls, only explicit Cancel cancels, and report enables Details', async () => {
  await reset(); await open();
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await domExpect(page.getByTestId('calls')).toHaveText('manual');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await domExpect(page.getByTestId('check-row').getByRole('progressbar')).toBeVisible();
  for (const label of ['Save', 'Check', 'Finalize']) await domExpect(page.getByRole('button', { name: label, exact: true })).toBeDisabled();
  await page.keyboard.press('Escape'); await domExpect(page.getByTestId('share-panel')).toHaveCount(0); await domExpect(page.getByTestId('job')).toHaveText('check');
  await open(); await page.getByTestId('outside').click(); await domExpect(page.getByTestId('job')).toHaveText('check');
  await open(); await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await domExpect(page.getByTestId('calls')).toHaveText('manual,check,cancel');
  await page.getByRole('button', { name: 'Finish check', exact: true }).click(); await open(); await page.getByRole('button', { name: 'Details', exact: true }).click();
  await domExpect(page.getByTestId('fake-flyout')).toBeVisible(); await domExpect(page.getByTestId('share-panel')).toBeVisible();
});
it('Finalize keeps lock status and bounded collapsible streamed output after dismissal', async () => {
  await reset(); await open(); await page.getByRole('button', { name: 'Finalize', exact: true }).click();
  await domExpect(page.getByTestId('finalize-row').getByRole('progressbar')).toBeVisible();
  await domExpect(page.getByTestId('lock-status')).toHaveText('Content locks current on disk.');
  await page.getByRole('button', { name: 'Finish finalize', exact: true }).click(); await open();
  const output = page.getByTestId('finalize-row').locator('details').filter({ has: page.locator('summary', { hasText: 'Finalize output' }) });
  await output.locator('summary').click(); await domExpect(output).toContainText('→ validate'); await domExpect(output).toContainText('Finalize complete.');
  expect(await output.locator('pre').evaluate(el => ({ height: getComputedStyle(el).maxHeight, overflow: getComputedStyle(el).overflowY, scroll: el.scrollHeight > el.clientHeight }))).toEqual({ height: '160px', overflow: 'auto', scroll: true });
  await page.keyboard.press('Escape'); await open(); await domExpect(page.getByTestId('finalize-row')).toContainText('Finalize output');
  await page.getByTestId('finalize-row').getByText('Content status details', { exact: true }).click(); await domExpect(page.getByTestId('finalize-row')).toContainText('Disk current');
});
it('Esc returns focus, Tab leaves and closes, and a child flyout consumes the first Escape', async () => {
  await reset(); await open(); await domExpect(page.getByRole('button', { name: 'Save', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await domExpect(page.getByTestId('share-button')).toBeFocused();
  await page.keyboard.press('Enter'); await domExpect(page.getByRole('button', { name: 'Save', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await domExpect(page.getByTestId('share-panel')).toHaveCount(0); await domExpect(page.getByTestId('share-button')).toBeFocused();
  await open(); await page.getByTestId('outside').click(); await domExpect(page.getByTestId('share-panel')).toHaveCount(0); await domExpect(page.getByTestId('outside')).toBeFocused();
  await open(); await page.getByRole('button', { name: 'Check', exact: true }).focus(); await page.keyboard.press('Tab'); await domExpect(page.getByTestId('share-panel')).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish check', exact: true }).click(); await open(); await page.getByRole('button', { name: 'Details', exact: true }).click();
  await page.getByRole('button', { name: 'Close flyout', exact: true }).focus(); await page.keyboard.press('Escape');
  await domExpect(page.getByTestId('fake-flyout')).toHaveCount(0); await domExpect(page.getByTestId('share-panel')).toBeVisible(); await domExpect(page.getByRole('button', { name: 'Details', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await domExpect(page.getByTestId('share-panel')).toHaveCount(0); await domExpect(page.getByTestId('share-button')).toBeFocused(); expect(errors).toEqual([]);
});
