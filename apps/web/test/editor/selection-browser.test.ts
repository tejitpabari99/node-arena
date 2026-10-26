import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import type { NextLevel } from '@node-arena/content';

let server: ViteDevServer, browser: Browser, page: Page;
const domExpect = browserExpect.configure({ timeout: 2000 });
beforeAll(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-test-selection', server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'selection-fixture', configureServer(s) {
    s.middlewares.use('/__selection', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(await s.transformIndexHtml('/__selection', '<!doctype html><html><body><main id="app"></main><script type="module" src="/test/editor/selection-fixture.tsx"></script></body></html>'));
    });
  } }] });
  await server.listen(); browser = await chromium.launch({ headless: true }); page = await browser.newPage(); page.setDefaultTimeout(2000);
}, 30000);
afterAll(async () => { await browser?.close(); await server?.close(); });
async function reset() { await page.goto(server.resolvedUrls!.local[0] + '__selection'); await page.locator('details').evaluateAll(nodes => nodes.forEach(node => { (node as HTMLDetailsElement).open = true; })); }
async function doc(): Promise<NextLevel> { return JSON.parse((await page.getByTestId('document').textContent())!); }
async function selected(value: string) { await page.getByLabel('Selected item').selectOption(value); await domExpect(page.getByTestId('selection')).toHaveText(value); await page.locator('details').evaluateAll(nodes => nodes.forEach(node => { (node as HTMLDetailsElement).open = true; })); }

it('commits owner and valid levels live, blocks invalid levels and supports undo without Apply', async () => {
  await reset();
  await page.getByLabel('Owner', { exact: true }).selectOption('p2');
  await domExpect(page.getByTestId('document')).toContainText('"owner":"p2"');
  const level = page.getByLabel('Level', { exact: true });
  await level.fill('33'); await level.press('Enter');
  await domExpect(level).toHaveAttribute('aria-invalid', 'true'); expect((await doc()).buildings[0]!.level).toBe(10);
  await level.fill('12'); await level.press('Enter');
  expect((await doc()).buildings[0]!.level).toBe(12);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await domExpect(level).toHaveValue('10');
  expect(await page.getByRole('button', { name: /Apply/ }).count()).toBe(0);
});

it('hides exactly the three tuning params, keeps their overrides, and merges separate live param edits', async () => {
  await reset();
  for (const name of ['Max level (garrison cap)', 'Regrow time multiplier', 'Per-extra-line slowdown']) expect(await page.getByLabel(name, { exact: true }).count()).toBe(0);
  const speed = page.getByLabel('Spawn speed', { exact: true });
  await speed.fill('0'); await speed.press('Enter');
  await domExpect(speed).toHaveAttribute('aria-invalid', 'true');
  await speed.fill('0.8001'); await speed.press('Enter');
  await domExpect(speed).toHaveAttribute('aria-invalid', 'true');
  await speed.fill('0.8'); await speed.press('Enter');
  expect((await doc()).buildings[0]!.params).toEqual({ level: { maxLevel: 32 }, grows: { growTime: 2 }, spawns: { lineSpawnPenalty: .7, spawnSpeed: .8 } });
  await speed.fill(''); await speed.press('Enter');
  expect((await doc()).buildings[0]!.params).toEqual({ level: { maxLevel: 32 }, grows: { growTime: 2 }, spawns: { lineSpawnPenalty: .7 } });
  await selected('building:tower');
  await page.getByLabel('Fire-rate gain per level', { exact: true }).fill('1.1');
  await page.evaluate(() => {
    (document.querySelector('input[aria-label="Fire-rate gain per level"]') as HTMLInputElement).blur();
    const select = document.querySelector('select[aria-label="Fires while neutral"]') as HTMLSelectElement;
    select.value = 'false'; select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await domExpect(page.getByTestId('document')).toContainText('"attackDelay":1.1');
  expect((await doc()).buildings[1]!.params).toMatchObject({ shoots: { attackDelay: 1.1, neutralFires: false } });
});

it('coalesces successive debounced number commits into one undo step', async () => {
  await reset();
  const level = page.getByLabel('Level', { exact: true });
  await level.fill('12'); await domExpect(page.getByTestId('document')).toContainText('"level":12');
  await level.fill('13'); await domExpect(page.getByTestId('document')).toContainText('"level":13');
  await domExpect(page.getByTestId('past')).toHaveText('1');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await domExpect(level).toHaveValue('10');
});

it('commits shape controls live, retains invalid text, and flushes a pending field when selection changes', async () => {
  await reset(); await selected('obstacle:rock');
  await page.getByLabel('Obstacle variant', { exact: true }).selectOption('big');
  expect((await doc()).elements[0]!.variant).toBe('big');
  await page.getByLabel('Footprint shape', { exact: true }).selectOption('box');
  const width = page.getByLabel('Footprint width', { exact: true });
  await width.fill('0'); await width.press('Enter'); await domExpect(width).toHaveAttribute('aria-invalid', 'true');
  expect((await doc()).elements[0]!.footprint).toEqual({ shape: 'box', w: 1, d: 1 });
  await width.fill('2'); await width.press('Enter');
  await page.getByLabel('Yaw (degrees)', { exact: true }).fill('45');
  // Switching via script avoids blur, exercising cleanup flush rather than browser focus behavior.
  await page.getByLabel('Selected item').evaluate(select => { (select as HTMLSelectElement).value = 'building:house'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect((await doc()).elements[0]).toMatchObject({ yawDeg: 45, footprint: { shape: 'box', w: 2, d: 1 } });
});

it('edits legacy single-tile rows with bounded length and rotation controls, one undo per rotation button', async () => {
  await reset(); await selected('obstacle:row');
  const length = page.getByLabel('Length (tiles)', { exact: true }), rotation = page.getByLabel('Rotation', { exact: true });
  await domExpect(length).toHaveValue('1');
  for (const name of ['Yaw (degrees)', 'Footprint shape', 'Footprint width', 'Footprint depth']) expect(await page.getByLabel(name, { exact: true }).count()).toBe(0);
  await length.fill('11'); await length.press('Enter'); await domExpect(length).toHaveAttribute('aria-invalid', 'true');
  expect((await doc()).elements[1]!.footprint).toBeUndefined();
  await length.fill('3'); await length.press('Enter');
  await rotation.fill('45'); await rotation.press('Enter');
  expect((await doc()).elements[1]).toMatchObject({ yawDeg: 45, footprint: { shape: 'box', w: 2.139, d: .713 } });
  await page.getByRole('button', { name: 'Rotate +15 degrees', exact: true }).click();
  await domExpect(rotation).toHaveValue('60');
  await page.getByRole('button', { name: 'Rotate +15 degrees', exact: true }).click();
  await domExpect(rotation).toHaveValue('75');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await domExpect(rotation).toHaveValue('60');
  await page.getByRole('button', { name: 'Rotate -15 degrees', exact: true }).click(); await domExpect(rotation).toHaveValue('45');
});

it('repeated equivalent rotation text snaps on Enter and blur without adding another undo step', async () => {
  await reset();
  await page.getByLabel('Selected item').selectOption('obstacle:row');
  await page.getByText('Shape', { exact: true }).click();
  const rotation = page.getByLabel('Rotation', { exact: true });
  await rotation.fill('23'); await rotation.press('Enter');
  await domExpect(rotation).toHaveValue('30');
  await rotation.fill('23'); await rotation.blur();
  await domExpect(rotation).toHaveValue('30');
  await domExpect(page.getByTestId('past')).toHaveText('1');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await domExpect(rotation).toHaveValue('0');
});
