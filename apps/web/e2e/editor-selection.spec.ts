import { undo as editorUndo, save as editorSave, historyDisabled, openCopied } from './editor-helpers.js';
import { test, expect, type Page } from '@playwright/test';
import type { LevelDoc } from '../src/editor/document.js';

async function open(page: Page, archetype = 'house-wt1', params?: LevelDoc['buildings'][number]['params']) {
  await page.route('**/__editor/level/levelview-1', async route => {
    const doc = await (await route.fetch()).json() as LevelDoc;
    doc.buildings = [
      { id: 'b0', archetype, pos: { x: -4, z: 0 }, owner: 'p1', level: 1, ignoreForWin: false, ...(params ? { params } : {}) },
      { id: 'b1', archetype: 'house-wt1', pos: { x: 4, z: 0 }, owner: 'p2', level: 1, ignoreForWin: false },
      { id: 'b2', archetype: 'house-wt1', pos: { x: 4, z: 3 }, owner: null, level: 1, ignoreForWin: false },
    ];
    doc.elements = [{ id: 'e0', archetype: 'obstacle', variant: 'small', pos: { x: 0, z: 0 }, yawDeg: 0 }];
    await route.fulfill({ json: doc });
  });
  await openCopied(page);
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
  await page.getByLabel('Spawn speed').fill('0.8');
  await page.getByLabel('Level', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Apply owner and level' }).click();
  await expect(page.getByLabel('Spawn speed')).toHaveValue('0.8');
  await expect(page.getByLabel('Level', { exact: true })).toHaveValue('3');
  await editorUndo(page);
  await expect(page.getByLabel('Level', { exact: true })).toHaveValue('1');
  expect(await historyDisabled(page, 'undo')).toBe(true);
  // Parameters Apply leaves owner/level untouched.
  await page.getByLabel('Owner', { exact: true }).selectOption('p2');
  await page.getByLabel('Spawn speed').fill('0.9');
  await page.getByRole('button', { name: 'Apply parameters' }).click();
  await editorUndo(page);
  await expect(page.getByLabel('Owner', { exact: true })).toHaveValue('p2');
  await expect(page.getByLabel('Spawn speed')).toHaveValue('');
  // LOS preview: no history entry.
  const before = await historyDisabled(page, 'undo');
  await page.getByLabel('LOS target').selectOption('b1');
  await expect(page.getByTestId('los-status')).toContainText('blocked-obstacle');
  await expect(page.locator('.editor-los')).toHaveCount(1);
  expect(await historyDisabled(page, 'undo')).toBe(before);
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
  await editorUndo(page);
  await expect(shell).toHaveAttribute('data-buildings', '3');
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(shell).toHaveAttribute('data-buildings', '0');
  await expect(shell).toHaveAttribute('data-obstacles', '0');
  await editorUndo(page);
  await expect(shell).toHaveAttribute('data-buildings', '3');
  await expect(shell).toHaveAttribute('data-obstacles', '1');
  // Exactly one selected clears multi mode.
  await selected(page).selectOption('building:b0');
  await expect(page.getByTestId('multi-count')).toHaveCount(0);
  await expect(selected(page)).toHaveValue('building:b0');
});

// Missing label/help wiring makes these fields inaccessible by their plain-English names.
test('Selection: house parameters expose readable names, help, and unchanged default order', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev-only editor');
  await open(page);
  await selected(page).selectOption('building:b0');
  await group(page, 'Owner and level');
  await group(page, 'Parameters');
  const optional = page.getByRole('checkbox', { name: 'Optional target (not needed to win)', exact: true });
  await expect(optional).toBeVisible();
  await expect(optional.locator('..')).toHaveAttribute('title', 'Decoy: no need to capture it to win; at least one building must stay required. (R-WIN-01/02, R-CPT-01)');
  const form = page.getByRole('form', { name: 'Parameters', exact: true });
  expect(await form.locator('label').evaluateAll(labels => labels.map(label => label.firstChild?.textContent))).toEqual([
    'Max level (garrison cap)', 'Unit produced', 'Spawn speed', 'Per-extra-line slowdown', 'Regrow time multiplier',
  ]);
  await expect(form.getByText('Leave blank to use the archetype default.', { exact: true })).toBeVisible();
  for (const [label, tooltip, placeholder] of [
    ['Max level (garrison cap)', 'Highest level this building reaches; extra troops are forwarded or lost. (R-CAP-01)', '64'],
    ['Spawn speed', 'Higher = troops leave each line faster, scaling with level. (R-SPN-01)', '0.5'],
    ['Per-extra-line slowdown', "Each extra outgoing line slows every line's spawning; 0 = none. (R-SPN-01)", '0.3'],
    ['Regrow time multiplier', 'Scales time to regain a level; only ticks with no outgoing lines. Higher = slower. (R-GRW-01)', '1.7'],
  ]) {
    const input = form.getByLabel(label!, { exact: true });
    await expect(input).toHaveAttribute('placeholder', placeholder!);
    await expect(input.locator('..')).toHaveAttribute('title', tooltip!);
  }
});

test('Selection: tower help explains firing semantics and boolean defaults use Yes/No', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev-only editor');
  await open(page, 'tower');
  await selected(page).selectOption('building:b0');
  await group(page, 'Parameters');
  const form = page.getByRole('form', { name: 'Parameters', exact: true });
  const fireGain = form.getByLabel('Fire-rate gain per level', { exact: true });
  await expect(fireGain.locator('..')).toHaveAttribute('title', 'Makes shots more frequent as level rises; higher = faster. (R-TWR-01)');
  const delay = form.getByLabel('Shot delay multiplier', { exact: true });
  await expect(delay.locator('..')).toHaveAttribute('title', 'Scales time between shots; higher = slower. (R-TWR-01)');
  for (const name of ['Fires while neutral', 'Shoots neutral houses']) {
    const select = form.getByRole('combobox', { name, exact: true });
    expect(await select.locator('option').allTextContents()).toEqual(['Default (Yes)', 'Yes', 'No']);
    await select.selectOption('false');
  }
  await page.getByRole('button', { name: 'Apply parameters' }).click();
  await expect(form.getByRole('combobox', { name: 'Fires while neutral', exact: true })).toHaveValue('false');
  await expect(form.getByRole('combobox', { name: 'Shoots neutral houses', exact: true })).toHaveValue('false');
  await editorUndo(page);
  await expect(form.getByRole('combobox', { name: 'Fires while neutral', exact: true })).toHaveValue('');
  await expect(form.getByRole('combobox', { name: 'Shoots neutral houses', exact: true })).toHaveValue('');
});

for (const overridden of [false, true]) {
  test(`Selection: produced unit is read-only and ${overridden ? 'Tank override survives' : 'Soldier default stays implicit through'} other edits and Save`, async ({ page }) => {
    test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Uses the real SelectionSection and editor save flow');
    let saved: LevelDoc | undefined;
    await page.route('**/__editor/save', async route => {
      saved = (route.request().postDataJSON() as { level: LevelDoc }).level;
      await route.fulfill({ json: { level: saved, warnings: [] } });
    });
    const params = overridden ? { spawns: { troop: 'tank', lineSpawnPenalty: 0.7 }, grows: { growTime: 2 } } : undefined;
    await open(page, 'house-wt1', params);
    await selected(page).selectOption('building:b0');
    await group(page, 'Parameters');
    const form = page.getByRole('form', { name: 'Parameters', exact: true });
    const unit = form.locator('label').filter({ hasText: /^Unit produced/ });
    await expect(unit).toContainText(overridden ? 'Tank' : 'Soldier');
    await expect(unit.locator('input, select, textarea, [contenteditable=true]')).toHaveCount(0);
    await expect(form.getByRole('textbox', { name: 'Unit produced', exact: true })).toHaveCount(0);
    await expect(unit.getByText('(override)', { exact: true })).toHaveCount(overridden ? 1 : 0);
    if (overridden) await expect(unit.getByText('(override)', { exact: true })).toHaveAttribute('title', "This level overrides the building's default unit");
    // Editing this module and another module must retain every existing override.
    await form.getByLabel('Spawn speed', { exact: true }).fill('0.9');
    await form.getByLabel('Max level (garrison cap)', { exact: true }).fill('32');
    await page.getByRole('button', { name: 'Apply parameters' }).click();
    await expect(unit).toContainText(overridden ? 'Tank' : 'Soldier');
    await editorSave(page);
    await expect.poll(() => saved?.buildings[0]?.params).toEqual({
      ...params, level: { maxLevel: 32 }, spawns: { ...params?.spawns, spawnSpeed: 0.9 },
    });
  });
}
