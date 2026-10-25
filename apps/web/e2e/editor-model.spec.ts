import { test, expect } from '@playwright/test';
import type { LevelDoc } from '../src/editor/document.js';

test('library drops, deletion, and undo/redo persist through real preview rebuilds', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Editor API is dev-only');
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  let saved: LevelDoc | undefined;
  await page.route('**/__editor/save', async route => {
    saved = (route.request().postDataJSON() as { level: LevelDoc }).level;
    await route.fulfill({ json: { level: saved, warnings: [] } });
  });
  await page.goto('/editor.html');
  await page.getByLabel('New level id').fill('na-model-browser');
  await page.getByRole('button', { name: 'Create blank' }).click();
  const host = page.getByLabel('Edit viewport'), box = (await host.boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const item = page.getByRole('button', { name: 'Place house-wt1', exact: true });
  const source = (await item.boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down(); await page.mouse.move(centre.x, centre.y, { steps: 8 });
  await expect(host.locator('.editor-ghost')).toBeVisible();
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', '0');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.mouse.up();
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', '1');
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  await expect(host.locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => saved?.buildings.length).toBe(1);
  expect(saved!.buildings[0]).toMatchObject({ owner: null, level: 1, pos: { x: 0, z: 0 } });
  await expect(page.getByTestId('viewport-selection')).toContainText('b0');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', '0');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', '1');
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  // One undo for the original drop proves its pointer moves were coalesced.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', '0');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});

import type { EditorViewport } from '../src/editor/viewport-engine.js';
import type { DocOp } from '../src/editor/model.js';
declare global { interface Window { __editorModel?: { viewport: EditorViewport; doc: LevelDoc; ops: DocOp[]; rebuilds: number } } }

test('single-item movement commits correct data coordinates once on release and retains selection', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Uses real dev viewport');
  await page.goto('/editor.html');
  const target = await page.evaluate(async () => {
    const path = '/src/editor/viewport-engine.ts', modelPath = '/src/editor/model.ts';
    const { createEditorViewport } = await import(/* @vite-ignore */ path) as typeof import('../src/editor/viewport-engine.js');
    const { reduceDocument } = await import(/* @vite-ignore */ modelPath) as typeof import('../src/editor/model.js');
    const doc = await (await fetch('/__editor/level/levelview-1')).json() as LevelDoc;
    const host = document.createElement('div'); host.className = 'editor-workspace';
    Object.assign(host.style, { position: 'absolute', left: '240px', top: '50px', width: '900px', height: '650px' }); document.body.append(host);
    const viewport = createEditorViewport(host, {
      status: status => { if (status.message === 'Ready') window.__editorModel!.rebuilds++; },
      edit: op => { const state = window.__editorModel!; state.ops.push(op); state.doc = reduceDocument(state.doc, op); void viewport.setDocument(state.doc); },
    });
    viewport.setSnap(false);
    window.__editorModel = { viewport, doc, ops: [], rebuilds: 0 }; await viewport.setDocument(doc);
    const scene = viewport.inspection!, anchor = scene.world.anchors.building('b0')!;
    const p = anchor.pos.clone().applyMatrix4(scene.worldRoot.matrixWorld).project(scene.camera), r = scene.canvas.getBoundingClientRect();
    return { x: r.left + (p.x + 1) * r.width / 2, y: r.top + (1 - p.y) * r.height / 2 };
  });
  const expected = await page.evaluate(p => {
    const { viewport, doc } = window.__editorModel!;
    const a = viewport.groundAt(p.x, p.y)!, b = viewport.groundAt(p.x + 45, p.y + 30)!;
    return { x: Math.round((doc.buildings[0]!.pos.x + b.x - a.x) * 100) / 100, z: Math.round((doc.buildings[0]!.pos.z + b.z - a.z) * 100) / 100 };
  }, target);
  await page.mouse.move(target.x, target.y); await page.mouse.down();
  await page.mouse.move(target.x + 45, target.y + 30, { steps: 12 });
  expect(await page.evaluate(() => ({ ops: window.__editorModel!.ops.length, rebuilds: window.__editorModel!.rebuilds }))).toEqual({ ops: 0, rebuilds: 1 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__editorModel!.rebuilds)).toBe(2);
  expect(await page.evaluate(() => window.__editorModel!.ops.length)).toBe(1);
  expect(await page.evaluate(() => window.__editorModel!.doc.buildings[0]!.pos)).toEqual(expected);
  expect(await page.evaluate(() => window.__editorModel!.viewport.selected)).toEqual([{ kind: 'building', id: 'b0' }]);
  expect(await page.evaluate(() => window.__editorModel!.viewport.previewSim!.view.buildingStatic[0]!.x)).toBe(Math.round(expected.x * 1000));
  // Returning to the drag origin must discard the transient ghost rather than commit its stale position.
  const movedTarget = await page.evaluate(() => {
    const scene = window.__editorModel!.viewport.inspection!, anchor = scene.world.anchors.building('b0')!;
    const p = anchor.pos.clone().applyMatrix4(scene.worldRoot.matrixWorld).project(scene.camera), r = scene.canvas.getBoundingClientRect();
    return { x: r.left + (p.x + 1) * r.width / 2, y: r.top + (1 - p.y) * r.height / 2 };
  });
  await page.mouse.move(movedTarget.x, movedTarget.y); await page.mouse.down();
  await page.mouse.move(movedTarget.x + 40, movedTarget.y + 20, { steps: 4 });
  await page.mouse.move(movedTarget.x, movedTarget.y, { steps: 4 }); await page.mouse.up();
  expect(await page.evaluate(() => window.__editorModel!.ops.length)).toBe(1);
  await page.evaluate(() => window.__editorModel!.viewport.dispose());
});


test('all library archetypes populate blank drafts and persist after compilation; outside drops cancel', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Editor API is dev-only');
  let saved: LevelDoc | undefined;
  await page.route('**/__editor/save', async route => {
    saved = (route.request().postDataJSON() as { level: LevelDoc }).level;
    await route.fulfill({ json: { level: saved, warnings: [] } });
  });
  await page.goto('/editor.html');
  await page.getByLabel('New level id').fill('na-library-browser');
  await page.getByRole('button', { name: 'Create blank' }).click();
  async function drop(item: string, dx: number, dy: number) {
    const source = (await page.getByRole('button', { name: `Place ${item}`, exact: true }).boundingBox())!;
    const r = (await page.getByLabel('Edit viewport').boundingBox())!;
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2); await page.mouse.down();
    await page.mouse.move(r.x + r.width / 2 + dx, r.y + r.height / 2 + dy, { steps: 5 }); await page.mouse.up();
  }
  await drop('obstacle-small', 0, 0);
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-obstacles', '1');
  await drop('obstacle-big', 60, 30);
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-obstacles', '2');
  await drop('house-wt1', -80, -20);
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  await drop('house-wt2', 30, -20);
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  await drop('tower', 90, 40);
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', '3');
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => saved?.buildings.length).toBe(3);
  expect(saved!.buildings.map(b => [b.archetype, b.owner, b.level])).toEqual([['house-wt1', null, 1], ['house-wt2', null, 1], ['tower', null, 1]]);
  expect(saved!.elements.map(e => e.variant)).toEqual(['small', 'big']);
  expect(saved!.elements[0]!.pos).toEqual({ x: 0, z: 0 });
  // Releasing over the library is cancellation, leaving the committed document intact.
  const source = (await page.getByRole('button', { name: 'Place tower', exact: true }).boundingBox())!;
  await page.mouse.move(source.x + 20, source.y + 10); await page.mouse.down(); await page.mouse.move(20, 20); await page.mouse.up();
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', '3');
});
