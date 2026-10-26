import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

let server: ViteDevServer, browser: Browser, page: Page;
const domExpect = browserExpect.configure({ timeout: 5000 });
beforeAll(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-test-place-center', server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); await server.warmupRequest('/src/editor/Editor.tsx'); await server.waitForRequestsIdle();
  browser = await chromium.launch({ headless: true }); page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); page.setDefaultTimeout(5000);
}, 30000);
afterAll(async () => { await browser?.close(); await server?.close(); });
it('double-click places and selects exactly one centered item, repeated clicks nudge, and each placement undoes once', async () => {
  await page.goto(server.resolvedUrls!.local[0] + 'editor.html?create=1');
  await page.getByLabel('New level id', { exact: true }).fill('na-center-browser');
  await page.getByTestId('create-confirm').click();
  const tile = page.getByRole('button', { name: 'Place tower', exact: true }), selected = page.getByLabel('Selected item', { exact: true });
  const buildings = selected.locator('option[value^="building:"]');
  await tile.dblclick(); await domExpect(buildings).toHaveCount(1); await domExpect(selected).toHaveValue('building:b0');
  await domExpect(page.getByTestId('viewport-selection')).toHaveText('building: b0');
  await tile.dblclick(); await domExpect(buildings).toHaveCount(2); await domExpect(selected).toHaveValue('building:b1');
  await domExpect(page.getByTestId('viewport-status')).toContainText('Ready');
  expect(await page.locator('.editor-ghost:not([hidden])').count()).toBe(0);
  await page.getByTestId('file-menu-button').click(); await page.getByTestId('menu-undo').click(); await domExpect(buildings).toHaveCount(1);
  await page.getByTestId('file-menu-button').click(); await page.getByTestId('menu-undo').click(); await domExpect(buildings).toHaveCount(0);
}, 20000);
