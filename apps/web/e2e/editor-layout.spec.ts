import { test, expect } from '@playwright/test';
import type { LevelDoc } from '../src/editor/document.js';

test('layout tools update a draft, snap Apply yaw, show actual blocked LOS, and persist fitted bounds only on Save', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev-only editor');
  let writes = 0, saved: LevelDoc | undefined;
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__editor/level/levelview-1', async route => {
    const doc = await (await route.fetch()).json() as LevelDoc;
    doc.buildings = [
      { id: 'b0', archetype: 'house-wt1', pos: { x: -4, z: 0 }, owner: 'p1', level: 1, ignoreForWin: false },
      { id: 'b1', archetype: 'house-wt1', pos: { x: 4, z: 0 }, owner: 'p2', level: 1, ignoreForWin: false },
    ];
    doc.elements = [{ id: 'e0', archetype: 'obstacle', variant: 'small', pos: { x: 0, z: 0 }, yawDeg: 0 }];
    await route.fulfill({ json: doc });
  });
  await page.route('**/__editor/save', async route => {
    writes++; saved = (route.request().postDataJSON() as { level: LevelDoc }).level;
    await route.fulfill({ json: { level: saved, warnings: [] } });
  });
  await page.goto('/editor.html');
  await page.getByLabel('New level id').fill('na-layout-browser');
  await page.getByLabel('Copy level').selectOption('levelview-1');
  await page.getByRole('button', { name: 'Copy level', exact: true }).click();
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  await expect(page.getByLabel('Grid snap')).toBeChecked();
  await page.getByLabel('Selected item', { exact: true }).selectOption('building:b0');
  await page.locator('[data-section=selection] summary', { hasText: 'Line of sight' }).click();
  await page.getByLabel('LOS target').selectOption('b1');
  await expect(page.getByTestId('los-status')).toContainText('blocked-obstacle');
  await expect(page.getByTestId('los-status')).toContainText('e0');
  await expect(page.locator('.editor-los line')).toHaveAttribute('stroke', '#fb7185');
  await expect(page.locator('.editor-los circle')).toBeVisible();
  await page.getByLabel('Selected item', { exact: true }).selectOption('obstacle:e0');
  await page.locator('[data-section=selection] summary', { hasText: 'Shape' }).click();
  await page.getByLabel('Yaw (degrees)').fill('23');
  await expect(page.getByLabel('Yaw (degrees)')).toHaveValue('23');
  await page.getByRole('button', { name: 'Apply shape' }).click();
  await expect(page.getByLabel('Yaw (degrees)')).toHaveValue('30');
  // Yaw always snaps to 15 degrees, even with Grid snap off.
  await page.getByLabel('Grid snap').uncheck();
  await page.getByLabel('Yaw (degrees)').fill('23');
  await page.getByRole('button', { name: 'Apply shape' }).click();
  await expect(page.getByLabel('Yaw (degrees)')).toHaveValue('30');
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-obstacles', '2');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-obstacles', '1');
  await page.getByLabel('Selected item', { exact: true }).selectOption('multi');
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await page.getByRole('button', { name: 'Auto-fit bounds', exact: true }).click();
  await expect(page.getByTestId('bounds-preview')).toContainText('x −6…6 · z −2…2');
  expect(writes).toBe(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => writes).toBe(1);
  expect(saved!.bounds).toEqual({ minX: -6, maxX: 6, minZ: -2, maxZ: 2 });
  expect(saved!.buildings.map(b => [b.pos, b.owner])).toEqual([[{ x: -4, z: 0 }, 'p1'], [{ x: 4, z: 0 }, 'p2']]);
  expect(saved!.elements[0]!.yawDeg).toBe(30);
  expect(errors).toEqual([]);
});

import type { EditorViewport } from '../src/editor/viewport-engine.js';
import type { DocHistory } from '../src/editor/model.js';
declare global { interface Window { __editorLayout?: { viewport: EditorViewport; history: DocHistory; rebuilds: number } } }

test('multi-selection drags use snapped shared deltas, ghosts only during motion, and one undo snapshot', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Real dev preview');
  await page.goto('/editor.html');
  const target = await page.evaluate(async () => {
    const path = '/src/editor/viewport-engine.ts', modelPath = '/src/editor/model.ts';
    const { createEditorViewport } = await import(/* @vite-ignore */ path) as typeof import('../src/editor/viewport-engine.js');
    const { createHistory, historyReducer } = await import(/* @vite-ignore */ modelPath) as typeof import('../src/editor/model.js');
    const doc = await (await fetch('/__editor/level/levelview-1')).json() as LevelDoc;
    doc.buildings = [
      { id: 'b0', archetype: 'house-wt1', pos: { x: -4, z: 0 }, owner: 'p1', level: 1, ignoreForWin: false },
      { id: 'b1', archetype: 'house-wt1', pos: { x: 4, z: 0 }, owner: 'p2', level: 1, ignoreForWin: false },
    ]; doc.elements = [];
    const host = document.createElement('div'); host.id = 'multi-fixture'; host.className = 'editor-workspace';
    Object.assign(host.style, { position: 'absolute', left: '240px', top: '50px', width: '900px', height: '650px' }); document.body.append(host);
    const viewport = createEditorViewport(host, {
      status: status => { if (status.message === 'Ready') window.__editorLayout!.rebuilds++; },
      edit: op => { const state = window.__editorLayout!; state.history = historyReducer(state.history, { type: 'edit', op }); void viewport.setDocument(state.history.present); },
    });
    window.__editorLayout = { viewport, history: createHistory(doc), rebuilds: 0 }; await viewport.setDocument(doc);
    viewport.select([{ kind: 'building', id: 'b0' }, { kind: 'building', id: 'b1' }]);
    const scene = viewport.inspection!, anchor = scene.world.anchors.building('b0')!;
    const p = anchor.pos.clone().applyMatrix4(scene.worldRoot.matrixWorld).project(scene.camera), r = scene.canvas.getBoundingClientRect();
    return { x: r.left + (p.x + 1) * r.width / 2, y: r.top + (1 - p.y) * r.height / 2 };
  });
  await page.mouse.move(target.x, target.y); await page.mouse.down();
  await page.mouse.move(target.x + 45, target.y + 30, { steps: 10 });
  await expect(page.locator('#multi-fixture .editor-ghost:visible')).toHaveCount(2);
  expect(await page.evaluate(() => ({ past: window.__editorLayout!.history.past.length, rebuilds: window.__editorLayout!.rebuilds }))).toEqual({ past: 0, rebuilds: 1 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__editorLayout!.rebuilds)).toBe(2);
  const result = await page.evaluate(() => {
    const state = window.__editorLayout!, [a, b] = state.history.present.buildings;
    return { past: state.history.past.length, selected: state.viewport.selected.length, a: a!.pos, b: b!.pos };
  });
  expect(result.past).toBe(1); expect(result.selected).toBe(2);
  expect(result.b.x - result.a.x).toBe(8); expect(result.b.z - result.a.z).toBe(0);
  expect(result.a.x * 4).toBe(Math.round(result.a.x * 4)); expect(result.a.z * 4).toBe(Math.round(result.a.z * 4));
  expect(result.a).not.toEqual({ x: -4, z: 0 });
  await expect(page.locator('#multi-fixture .editor-ghost:visible')).toHaveCount(0);
  const undone = await page.evaluate(async () => {
    const path = '/src/editor/model.ts'; const { historyReducer } = await import(/* @vite-ignore */ path) as typeof import('../src/editor/model.js');
    const state = window.__editorLayout!; state.history = historyReducer(state.history, { type: 'undo' });
    const positions = state.history.present.buildings.map(item => item.pos); state.viewport.dispose(); return positions;
  });
  expect(undone).toEqual([{ x: -4, z: 0 }, { x: 4, z: 0 }]);
});
