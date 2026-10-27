import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { mkdir } from 'node:fs/promises';
vi.setConfig({ testTimeout: 20000 });

let server: ViteDevServer, browser: Browser, page: Page;
const textureRequests: string[] = [];
const domExpect = browserExpect.configure({ timeout: 5000 });
beforeAll(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-test-toolbar', server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'toolbar-fixture', configureServer(s) {
    s.middlewares.use('/__toolbar', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(await s.transformIndexHtml('/__toolbar', '<!doctype html><html><body style="margin:0"><main id="app"></main><script type="module" src="/test/editor/toolbar-fixture.tsx"></script></body></html>'));
    });
  } }] });
  await server.listen(); await server.warmupRequest('/test/editor/toolbar-fixture.tsx'); await server.waitForRequestsIdle();
  browser = await chromium.launch({ headless: true }); page = await browser.newPage({ viewport: { width: 1100, height: 700 } }); page.setDefaultTimeout(10000);
  page.on('request', request => { if (/textures\/tw\/.*-gray\.png$/.test(request.url())) textureRequests.push(new URL(request.url()).pathname.split('/').at(-1)!); });
}, 60000);
afterAll(async () => { await browser?.close(); await server?.close(); });
const reset = async () => { await page.goto(server.resolvedUrls!.local[0] + '__toolbar'); };
it('uses a blue manual Save, icon Play and final neutral Share with unchanged panel actions', async () => {
  await reset();
  const bar = page.locator('header'), save = bar.getByRole('button', { name: 'Save', exact: true }), play = bar.getByRole('button', { name: 'Play', exact: true }), share = bar.getByRole('button', { name: 'Share', exact: true });
  await save.click(); await domExpect(page.getByTestId('calls')).toHaveText('save:manual');
  await page.mouse.move(600, 300);
  expect(await save.evaluate(button => getComputedStyle(button).backgroundColor)).toBe('rgb(37, 99, 201)');
  await domExpect(play).toHaveAttribute('title', 'Play'); expect(await play.textContent()).toBe(''); expect(await play.locator('svg').count()).toBe(1);
  await play.click(); await domExpect(page.getByTestId('calls')).toHaveText('save:manual,play');
  expect(await bar.getByRole('button').last().getAttribute('aria-label')).toBe('Share');
  expect(await share.locator('svg').count()).toBe(1); expect(await share.getAttribute('class')).not.toContain('ed-btn-primary');
  await share.click(); await domExpect(page.getByTestId('share-panel')).toBeVisible();
  for (const name of ['Save', 'Check', 'Finalize']) await domExpect(page.getByTestId('share-panel').getByRole('button', { name, exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Toggle lock' }).click();
  await domExpect(save).toBeDisabled(); await domExpect(play).toBeDisabled();
});
it('renders the three neutral building thumbnails using the real WebGL pipeline', async () => {
  textureRequests.length = 0;
  await reset(); await page.getByRole('button', { name: 'Render thumbnails' }).click();
  await browserExpect.configure({ timeout: 15000 })(page.getByTestId('thumbnails').locator('img')).toHaveCount(3);
  for (const name of ['house-wt1', 'house-wt2', 'tower']) {
    const image = page.getByRole('img', { name, exact: true });
    expect(await image.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(await image.evaluate(image => ({ width: (image as HTMLImageElement).naturalWidth, height: (image as HTMLImageElement).naturalHeight }))).toEqual({ width: 128, height: 128 });
  }
  expect([...new Set(textureRequests)].sort()).toEqual(['barracks-gray.png', 'factory-gray.png', 'tower-gray.png']);
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/sp06-toolbar-thumbnails.png' });
}, 20000);
