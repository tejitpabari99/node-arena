import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const development = process.env.WEB_TEST_SERVER === 'dev';

test('working copy renders, reports blank drafts, and has editor camera controls', async ({ page }) => {
  test.skip(!development, 'Editor API is dev-only');
  await page.goto('/editor.html');
  await page.getByLabel('New level id').fill('na-viewport');
  await page.getByRole('button', { name: 'Create blank' }).click();
  await expect(page.getByTestId('viewport-status')).toContainText('Add a building');
  await page.getByTestId('level-name').click();
  await page.getByLabel('New level id').fill('na-viewport');
  await page.getByLabel('Copy level').selectOption('levelview-1');
  await page.getByRole('button', { name: 'Copy level', exact: true }).click();
  await page.getByRole('button', { name: 'Discard and continue', exact: true }).click();
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  await expect(page.getByLabel('Edit viewport').locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Game camera', exact: true }).click();
});

import type { EditorViewport, ViewportStatus } from '../src/editor/viewport-engine.js';
import type { LevelDoc } from '../src/editor/document.js';
import type { Selection } from '../src/editor/picking.js';
declare global { interface Window { __editorViewport?: EditorViewport; __editorStatuses?: ViewportStatus[]; __editorSelection?: Selection[] } }

test('real preview opens all20, rebuilds edits, picks through offset rect, and supports camera and marquee', async ({ page }, testInfo) => {
  test.skip(!development, 'Uses dev module imports and local API');
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/editor.html');
  await page.evaluate(async () => {
    const path = '/src/editor/viewport-engine.ts';
    const { createEditorViewport } = await import(/* @vite-ignore */ path) as typeof import('../src/editor/viewport-engine.js');
    const host = document.createElement('div');
    host.id = 'viewport-fixture'; host.className = 'editor-workspace';
    Object.assign(host.style, { position: 'absolute', left: '240px', top: '100px', width: '900px', height: '650px' });
    document.body.append(host);
    window.__editorStatuses = [];
    window.__editorViewport = createEditorViewport(host, {
      status: status => window.__editorStatuses!.push(status), selection: items => { window.__editorSelection = items; },
    });
  });
  const results = await page.evaluate(async () => {
    const listings = await (await fetch('/__editor/levels')).json() as { id: string }[];
    const metrics: ({ id: string; buildings: number; obstacles: number } & ViewportStatus)[] = [];
    for (const item of listings.filter(item => item.id.startsWith('levelview-'))) {
      const doc = await (await fetch(`/__editor/level/${item.id}`)).json() as LevelDoc;
      await window.__editorViewport!.setDocument(doc);
      const last = window.__editorStatuses!.at(-1)!;
      if (last.message !== 'Ready') throw Error(`${item.id}: ${last.message}`);
      if (window.__editorViewport!.inspection!.world.pickMeshes.length < doc.buildings.length) throw Error(`Missing pick meshes: ${item.id}`);
      metrics.push({ id: item.id, buildings: doc.buildings.length, obstacles: doc.elements.length, ...last });
    }
    return metrics;
  });
  expect(results).toHaveLength(20);
  const largest = [...results].sort((a, b) => (b.buildings + b.obstacles) - (a.buildings + a.obstacles))[0]!;
  const warm = await page.evaluate(async id => {
    const doc = await (await fetch(`/__editor/level/${id}`)).json() as LevelDoc;
    await window.__editorViewport!.setDocument(doc);
    const values: ViewportStatus[] = [];
    for (let i = 0; i < 5; i++) { await window.__editorViewport!.setDocument(doc); values.push(window.__editorStatuses!.at(-1)!); }
    return values;
  }, largest.id);
  await testInfo.attach('rebuild-metrics', { body: JSON.stringify({ results, largest, warm }), contentType: 'application/json' });
  const environment = await page.evaluate(() => {
    const gl = window.__editorViewport!.inspection!.renderer.getContext();
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return { userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio,
      gpu: extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)) };
  });
  await writeFile('/tmp/node-arena-editor-task04-metrics.json', JSON.stringify({ environment, results, largest, warm }, null, 2));
  console.log('EDITOR_REBUILD_METRICS', JSON.stringify({ environment, largest, warm }));
  // A same-theme structural edit goes through setLevel and changes the real mesh location.
  const target = await page.evaluate(async () => {
    const doc = await (await fetch('/__editor/level/levelview-1')).json() as LevelDoc;
    doc.buildings[0]!.pos.x += .25;
    await window.__editorViewport!.setDocument(doc);
    const stage = window.__editorViewport!.inspection!;
    const anchor = stage.world.anchors.building('b0')!;
    const p = anchor.pos.clone().applyMatrix4(stage.worldRoot.matrixWorld).project(stage.camera);
    const r = stage.canvas.getBoundingClientRect();
    return { x: r.left + (p.x + 1) * r.width / 2, y: r.top + (1 - p.y) * r.height / 2, anchorX: anchor.pos.x };
  });
  expect(target.anchorX).toBeCloseTo(-6.54, 2);
  await page.mouse.click(target.x, target.y);
  expect(await page.evaluate(() => window.__editorSelection)).toEqual([{ kind: 'building', id: 'b0' }]);
  // Reuse the same public projection/ground seam after zoom and pan.
  await page.evaluate(() => window.__editorViewport!.zoomBy(1.4));
  const beforePan = await page.evaluate(() => window.__editorViewport!.inspection!.camera.position.toArray());
  await page.mouse.move(650, 450); await page.mouse.down({ button: 'middle' });
  await page.mouse.move(700, 480, { steps: 3 }); await page.mouse.up({ button: 'middle' });
  expect(await page.evaluate(() => window.__editorViewport!.inspection!.camera.position.toArray())).not.toEqual(beforePan);
  await page.evaluate(() => window.__editorViewport!.gameCamera());
  const zoom = await page.evaluate(() => window.__editorViewport!.inspection!.camera.zoom);
  expect(zoom).toBe(1);
  // Marquee starts in empty sky/ground, then includes the whole playable canvas.
  await page.mouse.move(245, 105); await page.mouse.down();
  await page.mouse.move(1135, 745, { steps: 5 });
  await expect(page.locator('.editor-marquee:visible')).toHaveCount(1);
  await page.mouse.up();
  expect(await page.evaluate(() => window.__editorSelection!.filter(item => item.kind === 'building').length)).toBe(5);
  // Explicit per-instance box footprint uses ground hit, independent of renderer pick meshes.
  const obstacleTarget = await page.evaluate(async () => {
    const doc = await (await fetch('/__editor/level/levelview-1')).json() as LevelDoc;
    doc.elements = [{ id: 'editor-rock', archetype: 'obstacle', pos: { x: 3, z: 5 }, yawDeg: 35, variant: 'big', footprint: { shape: 'box', w: 1, d: 2 } }];
    await window.__editorViewport!.setDocument(doc);
    const stage = window.__editorViewport!.inspection!;
    const p = stage.camera.position.clone().set(3, 0, 5).applyMatrix4(stage.worldRoot.matrixWorld).project(stage.camera);
    const r = stage.canvas.getBoundingClientRect();
    const x = r.left + (p.x + 1) * r.width / 2, y = r.top + (1 - p.y) * r.height / 2;
    return { x, y, point: window.__editorViewport!.groundAt(x, y) };
  });
  expect(obstacleTarget.point).toEqual({ x: 3, z: 5 });
  await page.mouse.click(obstacleTarget.x, obstacleTarget.y);
  expect(await page.evaluate(() => window.__editorSelection)).toEqual([{ kind: 'obstacle', id: 'editor-rock' }]);
  for (const id of ['levelview-1', 'levelview-20']) {
    await page.evaluate(async levelId => {
      const doc = await (await fetch(`/__editor/level/${levelId}`)).json() as LevelDoc;
      await window.__editorViewport!.setDocument(doc);
    }, id);
    await page.waitForLoadState('networkidle');
    await page.locator('#viewport-fixture').screenshot({ path: `/tmp/node-arena-editor-${id}.png` });
  }
  await page.evaluate(() => window.__editorViewport!.dispose());
  await expect(page.locator('#viewport-fixture canvas')).toHaveCount(0);
  await page.setViewportSize({ width: 900, height: 650 });
  for (const level of ['levelview-1', 'levelview-20']) {
    await page.goto(`/?test=1&level=${level}`);
    await expect.poll(() => page.evaluate(() => window.__na?.visualProbe().buildings.length ?? 0)).toBeGreaterThan(0);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => window.__na!.render());
    await page.screenshot({ path: `/tmp/node-arena-game-${level}.png` });
  }
  expect(errors).toEqual([]);
});

test('textures that finish after scene readiness appear without touching the camera', async ({ page }) => {
  test.skip(!development, 'Editor filesystem API is dev-only');
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/textures/tw/*-blue.png', async route => { await held; await route.continue(); });
  await page.goto('/editor.html');
  await page.getByLabel('New level id').fill('na-late-textures');
  await page.getByLabel('Copy level').selectOption('levelview-20');
  await page.getByRole('button', { name: 'Copy level', exact: true }).click();
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  const canvas = page.getByLabel('Edit viewport').locator('canvas');
  const before = await canvas.screenshot();
  const loaded = page.waitForResponse(response => response.url().endsWith('-blue.png'));
  release(); await loaded;
  await expect.poll(async () => !(await canvas.screenshot()).equals(before)).toBe(true);
});
