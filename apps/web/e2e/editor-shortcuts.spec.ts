import { openFile, share, openCopied } from './editor-helpers.js';
import { test, expect, type Page } from '@playwright/test';
import type { LevelDoc } from '../src/editor/document.js';

async function open(page: Page) {
  await page.route('**/__editor/level/levelview-1', async route => {
    const doc = await (await route.fetch()).json() as LevelDoc;
    doc.buildings = [
      { id: 'b0', archetype: 'house-wt1', pos: { x: -4, z: 0 }, owner: 'p1', level: 1, ignoreForWin: false },
      { id: 'b1', archetype: 'house-wt1', pos: { x: 4, z: 0 }, owner: 'p2', level: 1, ignoreForWin: false },
    ];
    doc.elements = [];
    await route.fulfill({ json: doc });
  });
  await openCopied(page);
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
}
const shell = (page: Page) => page.locator('.ed-shell');
const selected = (page: Page) => page.getByLabel('Selected item', { exact: true });
const pick = async (page: Page, v: string) => { await selected(page).selectOption(v); await expect(page.getByTestId('viewport-selection')).toHaveText(`building: ${v.split(':')[1]}`); await page.locator('body').click({ position: { x: 1, y: 1 } }); };
const count = (page: Page, n: number) => expect(shell(page)).toHaveAttribute('data-buildings', String(n));

test('Shortcuts: delete, copy/paste, undo/redo, esc clear', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev-only editor');
  await open(page);
  await pick(page, 'building:b0');
  await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
  await count(page, 3);
  await page.keyboard.press('Meta+v'); await count(page, 4);
  await page.keyboard.press('Control+z'); await count(page, 3);
  await page.keyboard.press('Control+Shift+z'); await count(page, 4);
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await count(page, 2);
  await page.keyboard.press('Control+y'); await count(page, 3);
  await pick(page, 'building:b1');
  await page.keyboard.press('Delete'); await count(page, 2);
  await page.keyboard.press('Control+z'); await count(page, 3);
  await pick(page, 'building:b1');
  await page.keyboard.press('Backspace'); await count(page, 2);
  await pick(page, 'building:b0');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('viewport-selection')).toHaveText('No selection');
});

test('Shortcuts: Ctrl+S saves without blocking; Esc cancels placement before selection', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev-only editor');
  await open(page);
  await page.route('**/__editor/save', async route => {
    const level = (route.request().postDataJSON() as { level: LevelDoc }).level;
    await route.fulfill({ json: { level, warnings: [] } });
  });
  await pick(page, 'building:b0');
  // Placement: Esc cancels placement first, selection stays.
  const src = (await page.getByRole('button', { name: 'Place tower', exact: true }).boundingBox())!;
  const box = (await page.getByLabel('Edit viewport').boundingBox())!;
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.move(2, 2); await page.mouse.up();
  await count(page, 2);
  await expect(page.getByTestId('viewport-selection')).toHaveText('building: b0');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('viewport-selection')).toHaveText('No selection');
  const saves: string[] = [];
  page.on('request', r => { if (r.method() !== 'GET' && r.url().includes('__editor')) saves.push(r.url()); });
  await page.keyboard.press('Control+s');
  await expect.poll(() => saves.length).toBeGreaterThan(0);
  await share(page);
  await expect(page.getByTestId('share-panel').getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
});

test('Shortcuts: none fire while typing or with a file dialog open', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev-only editor');
  await open(page);
  await pick(page, 'building:b0');
  await page.locator('[data-section=selection] summary', { hasText: 'Owner and level' }).click();
  const field = page.getByLabel('Level', { exact: true });
  await field.focus(); await page.keyboard.press('Delete'); await page.keyboard.press('Backspace'); await page.keyboard.press('Control+v'); await page.keyboard.press('Control+z');
  await count(page, 2);
  await expect(page.getByTestId('viewport-selection')).toHaveText('building: b0');
  await openFile(page, 'create');
  await expect(page.locator('[aria-modal=true]')).toBeVisible();
  await page.keyboard.press('Delete'); await page.keyboard.press('Control+z');
  await count(page, 2);
});

test('Shortcuts: Space activates a focused button elsewhere', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev-only editor');
  await open(page);
  await page.mouse.move(2, 2);
  const grid = page.getByRole('button', { name: /grid/i }).first();
  await grid.focus();
  const before = await grid.getAttribute('aria-pressed');
  await page.keyboard.press('Space');
  await expect(grid).not.toHaveAttribute('aria-pressed', before ?? '');
});
