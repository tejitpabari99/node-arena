import { test, expect, type Page } from '@playwright/test';
import type { LevelDoc } from '../src/editor/document.js';

async function open(page: Page) {
  await page.route('**/__editor/level/levelview-1', async route => {
    const doc = await (await route.fetch()).json() as LevelDoc;
    doc.buildings = [
      { id: 'b0', archetype: 'house-wt1', pos: { x: -4, z: 0 }, owner: 'p1', level: 1, ignoreForWin: false },
      { id: 'b1', archetype: 'house-wt1', pos: { x: 4, z: 0 }, owner: 'p2', level: 1, ignoreForWin: false },
      { id: 'b2', archetype: 'house-wt1', pos: { x: 4, z: 3 }, owner: null, level: 1, ignoreForWin: false },
    ];
    doc.elements = [{ id: 'e0', archetype: 'obstacle', variant: 'small', pos: { x: 0, z: 0 }, yawDeg: 0 }];
    await route.fulfill({ json: doc });
  });
  await page.goto('/editor.html?template=levelview-1');
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
}
const group = (page: Page, name: string) => page.locator('[data-section=selection] summary', { hasText: name }).click();
const selected = (page: Page) => page.getByLabel('Selected item', { exact: true });

test('Selection: dropdown lists friendly labels and syncs with canvas selection', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev-only editor');
  await open(page);
  expect(await selected(page).locator('option').allTextContents()).toEqual(['Nothing selected', 'Human house 1', 'AI1 house 1', 'Neutral house 1', 'Small obstacle 1', 'Multi-select']);
  await expect(selected(page)).toHaveValue('');
  await selected(page).selectOption({ label: 'AI1 house 1' });
  await expect(page.getByTestId('viewport-selection')).toHaveText('building: b1');
  await selected(page).selectOption('');
  await expect(page.getByTestId('viewport-selection')).toHaveText('No selection');
  // Canvas -> dropdown: dropping a library item (with nothing selected) selects it.
  const box = (await page.getByLabel('Edit viewport').boundingBox())!, src = (await page.getByRole('button', { name: 'Place tower', exact: true }).boundingBox())!;
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .8, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', '4');
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  await expect(selected(page).locator('option:checked')).toHaveText('Neutral tower 1');
});

test('Selection: each group Apply changes only its own fields; LOS previews without history', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev-only editor');
  await open(page);
  await selected(page).selectOption('building:b0');
  await group(page, 'Owner and level'); await group(page, 'Parameters'); await group(page, 'Line of sight');
  // Owner labels use playerLabel.
  expect(await page.getByLabel('Owner', { exact: true }).locator('option').allTextContents()).toEqual(['Neutral', 'Human', 'AI1']);
  // A pending Parameters draft survives an Owner/level Apply.
  await page.getByLabel('spawns spawnSpeed').fill('0.8');
  await page.getByLabel('Level', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Apply owner and level' }).click();
  await expect(page.getByLabel('spawns spawnSpeed')).toHaveValue('0.8');
  await expect(page.getByLabel('Level', { exact: true })).toHaveValue('3');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Level', { exact: true })).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  // Parameters Apply leaves owner/level untouched.
  await page.getByLabel('Owner', { exact: true }).selectOption('p2');
  await page.getByLabel('spawns spawnSpeed').fill('0.9');
  await page.getByRole('button', { name: 'Apply parameters' }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Owner', { exact: true })).toHaveValue('p2');
  await expect(page.getByLabel('spawns spawnSpeed')).toHaveValue('');
  // LOS preview: no history entry.
  const before = await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled();
  await page.getByLabel('LOS target').selectOption('b1');
  await expect(page.getByTestId('los-status')).toContainText('blocked-obstacle');
  await expect(page.locator('.editor-los')).toHaveCount(1);
  expect(await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled()).toBe(before);
  // Obstacle: Shape group, yaw always snaps.
  await selected(page).selectOption('obstacle:e0');
  await expect(page.locator('.editor-los')).toHaveCount(0);
  await group(page, 'Shape');
  await page.getByLabel('Yaw (degrees)').fill('23');
  await page.getByRole('button', { name: 'Apply shape' }).click();
  await expect(page.getByLabel('Yaw (degrees)')).toHaveValue('30');
});

test('Selection: multi-select actions and single Undo reverts multi-delete', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev-only editor');
  await open(page);
  const shell = page.locator('.ed-shell');
  await selected(page).selectOption('multi');
  await expect(page.getByTestId('multi-count')).toHaveText('0 selected');
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await expect(page.getByTestId('multi-count')).toHaveText('4 selected');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByTestId('multi-count')).toHaveText('0 selected');
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  await expect(shell).toHaveAttribute('data-buildings', '6');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(shell).toHaveAttribute('data-buildings', '3');
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(shell).toHaveAttribute('data-buildings', '0');
  await expect(shell).toHaveAttribute('data-obstacles', '0');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(shell).toHaveAttribute('data-buildings', '3');
  await expect(shell).toHaveAttribute('data-obstacles', '1');
  // Exactly one selected clears multi mode.
  await selected(page).selectOption('building:b0');
  await expect(page.getByTestId('multi-count')).toHaveCount(0);
  await expect(selected(page)).toHaveValue('building:b0');
});
