import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
vi.setConfig({ testTimeout: 20000 });
let server: ViteDevServer, browser: Browser, page: Page;
const errors: string[] = [];
const domExpect = browserExpect.configure({ timeout: 5000 });
beforeAll(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-test-editor-check-flyout', server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'check-fixture', configureServer(s) {
    s.middlewares.use('/__check', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(await s.transformIndexHtml('/__check', '<!doctype html><html><body style="margin:0"><main id="app"></main><script type="module" src="/test/editor/check-flyout-fixture.tsx"></script></body></html>'));
    });
  } }] });
  await server.listen(); await server.warmupRequest('/test/editor/check-flyout-fixture.tsx'); await server.waitForRequestsIdle();
  browser = await chromium.launch({ headless: true }); page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
}, 60000);
afterAll(async () => { await browser?.close(); await server?.close(); });
const reset = async () => { await page.goto(server.resolvedUrls!.local[0] + '__check'); };
const share = async () => { await page.getByTestId('share-button').click(); };
const show = async () => { await page.getByRole('button', { name: 'Show check', exact: true }).click(); };
const result = async () => {
  await share(); await page.getByRole('button', { name: 'Check', exact: true }).click();
  await page.getByRole('button', { name: 'Stream progress' }).click(); await page.getByRole('button', { name: 'Finish check' }).click();
  await domExpect(page.getByTestId('check-toast')).toContainText('Check: AI won 3/4');
  await page.getByTestId('check-toast').getByRole('button', { name: 'Details', exact: true }).click();
};
it('streams real check API events into toast Details; reopening both surfaces preserves full evidence', async () => {
  await reset(); await result();
  const flyout = page.getByTestId('check-popover');
  await domExpect(flyout).toHaveAttribute('role', 'dialog'); await domExpect(flyout).toHaveAccessibleName('Check details');
  await domExpect(page.getByTestId('share-panel')).toBeVisible();
  await domExpect(flyout).toContainText('not proof');
  await domExpect(flyout).toContainText('Auto-player won 3 of 4 test games. Level data is valid.');
  await domExpect(flyout).toContainText('Won · 0:06');
  await flyout.getByText('Full proxy report', { exact: true }).click(); await domExpect(flyout.locator('details pre')).toContainText('report-hash');
  await page.getByTestId('outside').click(); await domExpect(flyout).toHaveCount(0); await domExpect(page.getByTestId('share-panel')).toHaveCount(0);
  await page.getByTestId('check-toast').getByRole('button', { name: 'Details', exact: true }).click(); await domExpect(flyout).toBeVisible();
});
it('anchors 400px flyout 8px left of Share at the same top, z5, and resizes without covering controls', async () => {
  await reset(); await show();
  for (const width of [1440, 1024, 700]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction(() => { const flyout = document.querySelector('[data-testid="check-popover"]')!.getBoundingClientRect(), panel = document.querySelector('[data-testid="share-panel"]')!.getBoundingClientRect(); return Math.abs(panel.left - flyout.right - 8) < 1; });
    const flyout = (await page.getByTestId('check-popover').boundingBox())!, panel = (await page.getByTestId('share-panel').boundingBox())!, controls = (await page.getByTestId('map-controls').boundingBox())!;
    expect(flyout.y).toBe(panel.y); expect(flyout.x).toBeGreaterThanOrEqual(8); expect(flyout.x + flyout.width).toBe(panel.x - 8);
    expect(flyout.width).toBe(Math.min(400, panel.x - 16)); expect(panel.x + panel.width).toBeLessThanOrEqual(width - 56); expect(flyout.x + flyout.width).toBeLessThan(controls.x); expect(panel.x + panel.width).toBeLessThan(controls.x);
    expect(await page.getByTestId('check-popover').evaluate(el => getComputedStyle(el).zIndex)).toBe('5');
  }
  await page.setViewportSize({ width: 1440, height: 900 });
});
it('Escape closes only child then Share with focus return; close, panel clicks and Tab preserve job', async () => {
  await reset(); await result();
  await domExpect(page.getByRole('button', { name: 'Close check details' })).toBeFocused();
  await page.keyboard.press('Escape'); await domExpect(page.getByTestId('check-popover')).toHaveCount(0); await domExpect(page.getByTestId('share-panel')).toBeVisible();
  await domExpect(page.getByTestId('check-row').getByRole('button', { name: 'Details' })).toBeFocused();
  await page.keyboard.press('Escape'); await domExpect(page.getByTestId('share-panel')).toHaveCount(0); await domExpect(page.getByTestId('share-button')).toBeFocused();
  await page.getByTestId('check-toast').getByRole('button', { name: 'Details' }).click();
  await page.getByRole('button', { name: 'Close check details' }).click(); await domExpect(page.getByTestId('check-row').getByRole('button', { name: 'Details' })).toBeFocused();
  await page.getByTestId('check-row').getByRole('button', { name: 'Details' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await domExpect(page.getByTestId('check-popover')).toHaveCount(0); await domExpect(page.getByTestId('share-panel')).toBeVisible();
  await page.getByTestId('check-row').getByRole('button', { name: 'Details' }).click(); await page.keyboard.press('Shift+Tab');
  await domExpect(page.getByTestId('check-popover')).toHaveCount(0); await domExpect(page.getByTestId('share-panel')).toHaveCount(0);
  await domExpect(page.getByTestId('map-controls').getByRole('button')).toBeFocused();
});
it('dismissal never cancels running check; explicit Cancel retains cancellation error and issues', async () => {
  await reset(); await share(); await page.getByRole('button', { name: 'Check', exact: true }).click(); await show();
  await domExpect(page.getByTestId('check-popover').getByRole('progressbar')).toBeVisible();
  await page.keyboard.press('Escape'); await domExpect(page.getByTestId('job')).toHaveText('check'); await show();
  await page.getByRole('button', { name: 'Close check details' }).click(); await domExpect(page.getByTestId('job')).toHaveText('check');
  await page.getByTestId('outside').click(); await domExpect(page.getByTestId('job')).toHaveText('check'); await domExpect(page.getByTestId('cancels')).toHaveText('0');
  await show(); await page.getByTestId('check-popover').getByRole('button', { name: 'Cancel' }).click();
  await domExpect(page.getByTestId('job')).toHaveText('idle'); await domExpect(page.getByTestId('cancels')).toHaveText('1'); await domExpect(page.getByTestId('check-popover')).toContainText('Proxy check cancelled');
  await page.getByRole('button', { name: 'Invalid next check' }).click(); await share(); await page.getByRole('button', { name: 'Check', exact: true }).click();
  await domExpect(page.getByTestId('check-toast')).toContainText('Invalid level'); await show();
  await domExpect(page.getByRole('alert', { name: 'Check errors' })).toContainText('/players: Player required');
  // Failed check: Details stays reachable and the error is shown once, without evidence disclaimer.
  await page.getByRole('button', { name: 'Close check details' }).click();
  await domExpect(page.getByTestId('check-row').getByRole('button', { name: 'Details' })).toBeVisible();
  await show(); await domExpect(page.getByTestId('check-popover').getByText('not proof')).toHaveCount(0);
  expect(errors).toEqual([]);
});
