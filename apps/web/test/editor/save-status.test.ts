import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

let server: ViteDevServer, browser: Browser, page: Page;
const errors: string[] = [];
const domExpect = browserExpect.configure({ timeout: 1500 });
beforeAll(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-test-editor-save-status', server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'save-status-fixture', configureServer(s) {
    s.middlewares.use('/__save-status', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(await s.transformIndexHtml('/__save-status', '<!doctype html><html><body><main id="app"></main><script type="module" src="/test/editor/save-status-fixture.tsx"></script></body></html>'));
    });
  } }] });
  await server.listen();
  await server.warmupRequest('/test/editor/save-status-fixture.tsx');
  await server.waitForRequestsIdle();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  page.setDefaultTimeout(1500);
  page.on('pageerror', error => errors.push(error.message));
}, 30000);
afterAll(async () => { await browser?.close(); await server?.close(); });
const reset = async () => { await page.goto(server.resolvedUrls!.local[0] + '__save-status'); };

it('renders normal states as plain status text, green saved text and one checkmark', async () => {
  await reset();
  const chip = page.getByTestId('save-chip');
  await domExpect(chip).toHaveText('✓ Saved');
  expect(await chip.evaluate(el => ({ tag: el.tagName, role: el.getAttribute('role'), border: getComputedStyle(el).borderTopWidth, background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, before: getComputedStyle(el, '::before').content }))).toEqual({ tag: 'SPAN', role: 'status', border: '0px', background: 'rgba(0, 0, 0, 0)', color: 'rgb(21, 128, 61)', before: 'none' });
  for (const [button, text] of [['saving', 'Saving…'], ['unsaved', 'Unsaved'], ['saved', '✓ Saved']] as const) {
    await page.getByRole('button', { name: button, exact: true }).click();
    await domExpect(chip).toHaveText(text!);
    expect(await chip.evaluate(el => el.tagName)).toBe('SPAN');
  }
  await page.getByRole('button', { name: 'Warnings', exact: true }).click();
  expect(await chip.evaluate(el => el.tagName)).toBe('SPAN');
  await domExpect(page.getByTestId('save-popover')).toHaveCount(0);
});
it('issues and messages are buttons with a right-aligned, dismissible popover', async () => {
  await reset();
  await page.getByRole('button', { name: 'Issues', exact: true }).click();
  const chip = page.getByTestId('save-chip'), popover = page.getByTestId('save-popover');
  await domExpect(chip).toHaveText('1 issues');
  expect(await chip.evaluate(el => ({ tag: el.tagName, border: getComputedStyle(el).borderTopWidth }))).toEqual({ tag: 'BUTTON', border: '0px' });
  await chip.click();
  await domExpect(popover).toContainText('Field /buildings: Invalid building');
  const chipBox = (await chip.boundingBox())!, popoverBox = (await popover.boundingBox())!;
  expect(popoverBox.x + popoverBox.width).toBeCloseTo(chipBox.x + chipBox.width, 0);
  expect(popoverBox.y).toBeGreaterThanOrEqual(chipBox.y + chipBox.height);
  await page.keyboard.press('Escape');
  await domExpect(popover).toHaveCount(0);
  await domExpect(chip).toBeFocused();
  await chip.click(); await page.getByRole('button', { name: 'Outside', exact: true }).click();
  await domExpect(popover).toHaveCount(0);
  await domExpect(page.getByRole('button', { name: 'Outside', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Message', exact: true }).click();
  await domExpect(chip).toHaveText("Can't save");
  await chip.click();
  await domExpect(page.getByTestId('save-message')).toHaveText('Disk full');
  await page.keyboard.press('Tab');
  await domExpect(popover).toHaveCount(0);
});
it('auto-opens each manual failure, includes warnings, and closes on success', async () => {
  await reset();
  await page.getByRole('button', { name: 'Warnings', exact: true }).click();
  await page.getByRole('button', { name: 'Manual failure', exact: true }).click();
  await domExpect(page.getByTestId('save-popover')).toContainText('Ignored script');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Manual failure', exact: true }).click();
  await domExpect(page.getByTestId('save-popover')).toBeVisible();
  await page.getByRole('button', { name: 'saved', exact: true }).click();
  await domExpect(page.getByTestId('save-popover')).toHaveCount(0);
  expect(errors).toEqual([]);
});
