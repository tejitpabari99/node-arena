import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
let server: ViteDevServer, browser: Browser, page: Page;
const domExpect = browserExpect.configure({ timeout: 2000 });
beforeAll(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-test-live-level', server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'live-level-fixture', configureServer(s) {
    s.middlewares.use('/__live-level', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(await s.transformIndexHtml('/__live-level', '<!doctype html><html><body><main id="app"></main><script type="module" src="/test/editor/live-level-fixture.tsx"></script></body></html>'));
    });
  } }] });
  await server.listen();
  browser = await chromium.launch({ headless: true }); page = await browser.newPage();
}, 30000);
afterAll(async () => { await browser?.close(); await server?.close(); });
const reset = async () => { await page.goto(server.resolvedUrls!.local[0] + '__live-level'); };
const readDoc = async () => JSON.parse((await page.getByTestId('doc').textContent())!);
it('commits Snow immediately with one undo and coalesces debounced names', async () => {
  await reset();
  await page.getByLabel('Level theme').selectOption('snow');
  expect((await readDoc()).theme).toBe('snow');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await readDoc()).theme).toBe('green');
  const name = page.getByLabel('Level name');
  await name.fill('Arena');
  await domExpect(page.getByTestId('doc')).toContainText('"name":"Arena"');
  await name.fill('Arena expanded');
  await domExpect(page.getByTestId('doc')).toContainText('"name":"Arena expanded"');
  await domExpect(page.getByTestId('past')).toHaveText('1');
  await name.blur(); await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await domExpect(name).not.toHaveValue('Arena expanded');
});
it('keeps empty names, invalid AI delays and duplicate colors local', async () => {
  await reset();
  const initial = await readDoc(), name = page.getByLabel('Level name');
  await name.fill(''); await name.blur();
  expect((await readDoc()).name).toBe(initial.name); await domExpect(name).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'AI1 card' }).click();
  const delay = page.getByLabel('AI1 action delay (ms)');
  for (const value of ['49', '50.5', '']) {
    await delay.fill(value); await delay.blur();
    await domExpect(delay).toHaveAttribute('aria-invalid', 'true');
    expect((await readDoc()).players[1].bot.actionDelayMs).toBe(4000);
  }
  const color = page.getByLabel('AI1 color');
  await color.selectOption('blue'); await domExpect(color).toHaveAttribute('aria-invalid', 'true');
  expect((await readDoc()).players[1].colorKey).toBe('red');
  await color.selectOption('green'); expect((await readDoc()).players[1].colorKey).toBe('green');
  await domExpect(color).not.toHaveAttribute('aria-invalid');
});
it('preserves a pending name when blur and theme change happen in one turn', async () => {
  await reset();
  await page.getByLabel('Level name').fill('Pending name');
  await page.evaluate(() => {
    (document.querySelector('input') as HTMLInputElement).blur();
    const theme = document.querySelector('[aria-label="Level theme"]') as HTMLSelectElement;
    theme.value = 'snow'; theme.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await domExpect(page.getByTestId('doc')).toContainText('"name":"Pending name"');
  expect((await readDoc()).theme).toBe('snow');
});
it('Add AI chooses an eligible neutral house and undo removes both changes', async () => {
  await reset();
  await page.getByRole('button', { name: 'Add AI', exact: true }).click();
  const doc = await readDoc();
  expect(doc.players).toHaveLength(3);
  expect(doc.buildings.filter((b: { owner: string | null }) => b.owner === 'p3')).toHaveLength(1);
  expect(doc.buildings[2].owner).toBeNull();
  await domExpect(page.getByTestId('past')).toHaveText('1');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const undone = await readDoc(); expect(undone.players).toHaveLength(2);
  expect(undone.buildings.every((b: { owner: string | null }) => b.owner === null)).toBe(true);
});
it('coalesces delay typing, keeps behavior separate, and validates optional time limits', async () => {
  await reset();
  await page.getByRole('button', { name: 'AI1 card' }).click();
  const delay = page.getByLabel('AI1 action delay (ms)');
  await delay.fill('500'); await domExpect(page.getByTestId('doc')).toContainText('"actionDelayMs":500');
  await delay.fill('600'); await domExpect(page.getByTestId('doc')).toContainText('"actionDelayMs":600');
  await domExpect(page.getByTestId('past')).toHaveText('1');
  await page.getByLabel('AI1 behavior').selectOption('attackOnly');
  const player = (await readDoc()).players[1];
  expect(player.bot.actionDelayMs).toBe(600); expect(player.bot.behavior).toBe('attackOnly');
  await domExpect(page.getByTestId('past')).toHaveText('2');
  const time = page.getByLabel('Time limit (seconds)');
  for (const value of ['0', '1.5', '107374183']) {
    await time.fill(value); await time.blur();
    await domExpect(time).toHaveAttribute('aria-invalid', 'true'); expect((await readDoc()).timeLimitSec).toBeNull();
  }
  await time.fill('90'); await time.press('Enter'); expect((await readDoc()).timeLimitSec).toBe(90);
  await time.fill(''); await time.blur(); expect((await readDoc()).timeLimitSec).toBeNull();
  await domExpect(page.getByRole('button', { name: /Apply/ })).toHaveCount(0);
});
it('deletes AI immediately after confirmation, neutralizes its buildings, and undoes both', async () => {
  await reset();
  await page.getByRole('button', { name: 'Add AI', exact: true }).click();
  await page.getByRole('button', { name: 'Delete AI2', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  const doc = await readDoc();
  expect(doc.players).toHaveLength(2);
  expect(doc.buildings.every((b: { owner: string | null }) => b.owner === null)).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const undone = await readDoc(); expect(undone.players).toHaveLength(3);
  expect(undone.buildings.filter((b: { owner: string | null }) => b.owner === 'p3')).toHaveLength(1);
});
