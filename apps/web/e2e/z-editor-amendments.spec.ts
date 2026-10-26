import { test, expect, type Page, type Locator } from '@playwright/test';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankDocument, type LevelDoc } from '../src/editor/document.js';
import { acceptDialogs } from './helpers.js';
import { openCopied, save, share, undo, redo } from './editor-helpers.js';

const data = fileURLToPath(new URL('../../../packages/content/data/', import.meta.url));
async function shot(page: Page, name: string, target?: Locator) {
  if (!process.env.SP06_SHOT_DIR) return;
  await mkdir(process.env.SP06_SHOT_DIR, { recursive: true });
  const path = resolve(process.env.SP06_SHOT_DIR, `${name}.png`);
  if (target) await target.screenshot({ path }); else await page.screenshot({ path });
}
async function scenario(page: Page, neutralHouse = true) {
  const source = blankDocument('na-source', 'green', 'medium');
  source.buildings = [
    { id: 'b0', archetype: 'house-wt1', pos: { x: -4, z: 0 }, owner: 'p1', level: 1, ignoreForWin: false },
    { id: 'b1', archetype: 'house-wt2', pos: { x: 4, z: 0 }, owner: 'p2', level: 1, ignoreForWin: false },
    { id: 'tower', archetype: 'tower', pos: { x: 4, z: 5 }, owner: null, level: 1, ignoreForWin: false },
    ...(neutralHouse ? [{ id: 'neutral', archetype: 'house-wt1', pos: { x: -4, z: 5 }, owner: null, level: 1, ignoreForWin: false }] : []),
  ];
  await page.route('**/__editor/level/levelview-1', route => route.fulfill({ json: source }));
  await page.route('**/__editor/status', route => route.fulfill({ json: { unfinalized: true, exitCode: 1, output: '' } }));
  await openCopied(page);
}
async function captureSaves(page: Page) {
  const snapshots: LevelDoc[] = [];
  await page.route('**/__editor/save', route => {
    const level = (route.request().postDataJSON() as { level: LevelDoc }).level;
    snapshots.push(level);
    return route.fulfill({ json: { level: { ...level, editorVersion: '0.0.1' }, warnings: [] } });
  });
  return snapshots;
}

test.beforeEach(async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev-only editor amendments');
  acceptDialogs(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
});

test('live invalid fields stay local, typing undoes as one burst, Add AI owns one house in one step', async ({ page }) => {
  const saved = await captureSaves(page);
  await scenario(page);
  const top = page.locator('.ed-top');
  await expect(top.getByRole('button', { name: 'Save', exact: true })).toHaveClass(/ed-btn-primary/);
  await expect(top.getByRole('button', { name: 'Play', exact: true })).toHaveText('');
  await expect(top.getByRole('button', { name: 'Share', exact: true })).not.toHaveClass(/ed-btn-primary/);
  await shot(page, 'bar', top);
  await expect(page.locator('.ed-library-tile img')).toHaveCount(5, { timeout: 30000 });
  await shot(page, 'grey-library', page.locator('[data-section=library]'));
  const name = page.getByLabel('Level name');
  await name.fill('Typing'); await page.waitForTimeout(450);
  await name.fill('Typing burst'); await page.waitForTimeout(450);
  await name.blur(); await undo(page); await expect(name).toHaveValue('na-source');
  await redo(page); await expect(name).toHaveValue('Typing burst');
  await name.fill(''); await name.blur(); await expect(name).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'AI1 card', exact: true }).click();
  const delay = page.getByLabel('AI1 action delay (ms)');
  await delay.fill('49'); await delay.blur(); await expect(delay).toHaveAttribute('aria-invalid', 'true');
  const color = page.getByLabel('AI1 color');
  await color.selectOption('blue'); await expect(color).toHaveAttribute('aria-invalid', 'true');
  await shot(page, 'level', page.locator('[data-section=level]'));
  await save(page); await expect.poll(() => saved.length).toBe(1);
  expect(saved[0]).toMatchObject({ name: 'Typing burst', players: [{ id: 'p1', colorKey: 'blue' }, { id: 'p2', colorKey: 'red', bot: { actionDelayMs: 4000 } }] });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Add AI', exact: true }).click();
  await save(page); await expect.poll(() => saved.length).toBe(2);
  expect(saved[1]!.players.map(player => player.id)).toEqual(['p1', 'p2', 'p3']);
  expect(saved[1]!.buildings.find(item => item.id === 'neutral')!.owner).toBe('p3');
  expect(saved[1]!.buildings.find(item => item.id === 'tower')!.owner).toBeNull();
  await page.keyboard.press('Escape'); await undo(page); await save(page);
  await expect.poll(() => saved.length).toBe(3);
  expect(saved[2]!.players.map(player => player.id)).toEqual(['p1', 'p2']);
  expect(saved[2]!.buildings.find(item => item.id === 'neutral')!.owner).toBeNull();
});

test('double-click rows place, edit and play as one item, nudge occupied centers and undo separately', async ({ page }) => {
  const saved = await captureSaves(page);
  await scenario(page);
  const small = page.getByRole('button', { name: 'Place obstacle-small', exact: true });
  await small.dblclick();
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-obstacles', '1');
  await expect(page.getByLabel('Selected item', { exact: true })).toHaveValue('obstacle:e0');
  await page.locator('[data-section=selection] summary', { hasText: 'Shape' }).click();
  await expect(page.getByLabel('Length (tiles)')).toHaveValue('5');
  await page.getByLabel('Length (tiles)').fill('3'); await page.getByLabel('Length (tiles)').press('Enter');
  await page.getByLabel('Rotation', { exact: true }).fill('45'); await page.getByLabel('Rotation', { exact: true }).press('Enter');
  await expect(page.getByLabel('Rotation', { exact: true })).toHaveValue('45');
  await page.locator('.ed-left').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await shot(page, 'row-selection');
  await save(page); await expect.poll(() => saved.length).toBe(1);
  expect(saved[0]!.elements).toHaveLength(1);
  expect(saved[0]!.elements[0]).toMatchObject({ pos: { x: 0, z: 0 }, yawDeg: 45, footprint: { shape: 'box', w: 2.139, d: .713 } });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.editor-play-arena canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Back to editor', exact: true }).click();
  await small.dblclick(); await expect(page.locator('.ed-shell')).toHaveAttribute('data-obstacles', '2');
  await save(page); await expect.poll(() => saved.length).toBe(2);
  expect(saved[1]!.elements[1]!.pos).not.toEqual({ x: 0, z: 0 });
  for (const coordinate of Object.values(saved[1]!.elements[1]!.pos)) expect(coordinate * 4).toBe(Math.round(coordinate * 4));
  await page.keyboard.press('Escape'); await undo(page);
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-obstacles', '1');
  await page.getByLabel('Selected item', { exact: true }).selectOption('building:b0');
  await page.locator('[data-section=selection] summary', { hasText: 'Line of sight' }).click();
  await page.getByLabel('LOS target').selectOption('b1');
  await expect(page.getByTestId('los-status')).toContainText('blocked-obstacle');
  await page.getByLabel('Selected item', { exact: true }).selectOption('obstacle:e0');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-obstacles', '0');
  await page.getByLabel('Selected item', { exact: true }).selectOption('building:b0');
  await page.locator('[data-section=selection] summary', { hasText: 'Line of sight' }).click();
  await page.getByLabel('LOS target').selectOption('b1');
  await expect(page.getByTestId('los-status')).toContainText(/clear/i);
});

test('Save accepts a player without a house; real Check and Finalize fail before changing locks', async ({ page }) => {
  test.setTimeout(90000);
  const custom = resolve(data, 'campaigns/custom.json'), original = await readFile(custom, 'utf8');
  let createdId = '';
  try {
    await scenario(page, false);
    createdId = (await page.getByLabel('Level id', { exact: true }).textContent())!;
    await page.getByRole('button', { name: 'Add AI', exact: true }).click();
    await share(page); await page.getByRole('button', { name: 'Check', exact: true }).click();
    await page.locator('.ed-toast-error').getByRole('button', { name: 'Details', exact: true }).click();
    await expect(page.getByRole('alert', { name: 'Check errors' })).toContainText('AI2 has no starting house');
    await page.locator('.ed-toast-error').getByRole('button', { name: 'Dismiss notice', exact: true }).click();
    await share(page);
    await page.getByTestId('check-row').getByRole('button', { name: 'Details', exact: true }).click();
    await expect(page.getByRole('alert', { name: 'Check errors' })).toContainText('AI2 has no starting house');
    await shot(page, 'check-error');
    await page.keyboard.press('Escape');
    const response = page.waitForResponse(response => response.url().endsWith('/__editor/save'));
    await save(page); expect((await response).ok()).toBe(true);
    // A content write may reload Vite. Reopen the saved id before checking its real finalize worker.
    await expect(async () => {
      await page.goto('/?test=1', { timeout: 15000 });
      await page.getByRole('button', { name: 'Custom', exact: true }).click();
      await page.getByRole('link', { name: `Edit ${createdId}`, exact: true }).click();
      await expect(page.getByLabel('Level id', { exact: true })).toHaveText(createdId);
    }).toPass({ timeout: 60000 });
    await share(page); await page.getByRole('button', { name: 'Finalize', exact: true }).click();
    const panel = page.getByTestId('share-panel');
    await expect(panel.getByRole('alert')).toContainText('validate', { timeout: 30000 });
    await panel.getByText('Finalize output', { exact: true }).click();
    await expect(panel).toContainText('AI2 has no starting house');
    await expect(panel).not.toContainText('→ contentVersion');
  } finally {
    await writeFile(custom, original);
    if (createdId) await rm(resolve(data, 'levels', `${createdId}.json`), { force: true });
  }
});
