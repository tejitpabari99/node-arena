import { undo as editorUndo, openFile, openCopied } from './editor-helpers.js';
import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const development = process.env.WEB_TEST_SERVER === 'dev';

test('working copy renders, reports blank drafts, and has editor camera controls', async ({ page }) => {
  test.skip(!development, 'Editor API is dev-only');
  await page.goto('/editor.html');
  await page.getByLabel('New level id').fill('na-viewport');
  await page.getByTestId('create-confirm').click();
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  await openFile(page, 'create');
  await page.getByLabel('New level id').fill('na-viewport-copy');
  await page.getByLabel('Copy existing level', { exact: true }).selectOption('levelview-1');
  await page.getByTestId('create-confirm').click();
  await page.getByTestId('confirm-discard').click();
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  await expect(page.getByLabel('Edit viewport').locator('canvas')).toBeVisible();
  await page.getByTestId('canvas-controls').getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByTestId('canvas-controls').getByRole('button', { name: 'Game camera', exact: true }).click();
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
  await page.getByLabel('Copy existing level', { exact: true }).selectOption('levelview-20');
  await page.getByTestId('create-confirm').click();
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  const canvas = page.getByLabel('Edit viewport').locator('canvas');
  const before = await canvas.screenshot();
  const loaded = page.waitForResponse(response => response.url().endsWith('-blue.png'));
  release(); await loaded;
  await expect.poll(async () => !(await canvas.screenshot()).equals(before)).toBe(true);
});

test('failed rebuild keeps the last scene with an error badge, disables picking, and clears on undo', async ({ page }) => {
  test.skip(!development, 'Editor API is dev-only');
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
  const status = page.getByTestId('viewport-status'), badge = page.getByTestId('preview-error');
  await expect(status).toContainText('Ready');
  const box = (await page.getByLabel('Edit viewport').boundingBox())!, src = (await page.getByRole('button', { name: 'Place tower', exact: true }).boundingBox())!;
  const drop = { x: box.x + box.width * .5, y: box.y + box.height * .8 };
  const place = async () => {
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2); await page.mouse.down();
    await page.mouse.move(drop.x, drop.y, { steps: 8 }); await page.mouse.up();
  };
  // The view is stable across edits, so re-dropping at one screen point lands on the identical snapped
  // position: the second drop is a coincident building and the compile fails.
  await place();
  await expect(status).toContainText('Ready');
  await place();
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute('role', 'alert');
  await expect(badge).toContainText('Preview out of date');
  await expect(badge).toContainText('Coincident');
  await expect(status).not.toContainText('Preview unavailable');
  await expect(page.getByLabel('Edit viewport').locator('canvas')).toBeVisible();
  // Picking is disabled while stale, even directly on the previously rendered tower.
  await page.getByLabel('Selected item', { exact: true }).selectOption('');
  await page.mouse.click(drop.x, drop.y);
  await expect(page.getByTestId('viewport-selection')).toHaveText('No selection');
  // Undo restores a valid document; the badge clears and picking works again.
  await editorUndo(page);
  await expect(badge).toHaveCount(0);
  await expect(status).toContainText('Ready');
  await page.getByLabel('Selected item', { exact: true }).selectOption('');
  await page.mouse.click(drop.x, drop.y);
  await expect(page.getByTestId('viewport-selection')).toContainText('building:');
});

test('camera model: stable on edit, anchored wheel, limits, fit area, game camera, default zoom', async ({ page }, testInfo) => {
  test.skip(!development, 'Uses dev module imports and local API');
  test.setTimeout(120000);
  await page.goto('/editor.html');
  await page.evaluate(async () => {
    const path = '/src/editor/viewport-engine.ts';
    const { createEditorViewport } = await import(/* @vite-ignore */ path) as typeof import('../src/editor/viewport-engine.js');
    const host = document.createElement('div');
    host.id = 'viewport-fixture'; host.className = 'editor-workspace';
    Object.assign(host.style, { position: 'absolute', left: '240px', top: '100px', width: '900px', height: '650px' });
    document.body.append(host);
    window.__editorViewport = createEditorViewport(host, {});
    const doc = await (await fetch('/__editor/level/na-trial')).json() as LevelDoc;
    const model = '/src/editor/model.ts';
    const { buildableArea } = await import(/* @vite-ignore */ model) as typeof import('../src/editor/model.js');
    window.__editorViewport.setArea(buildableArea(doc.bounds)); // fixed per doc open, like Editor's ctx.area
    await window.__editorViewport.setDocument(doc);
    (window as unknown as { __doc: LevelDoc }).__doc = doc;
  });
  const read = () => page.evaluate(() => { const v = window.__editorViewport!, c = v.inspection!.camera; return { ...v.viewState, pos: c.position.toArray(), zoom: c.zoom }; });
  const initial = await read();
  console.log(`default zoom na-trial: ${initial.zoom.toFixed(3)} (min ${initial.min.toFixed(3)} max ${initial.max})`);
  testInfo.annotations.push({ type: 'default-zoom-na-trial', description: initial.zoom.toFixed(3) });
  expect(initial.zoom).toBeGreaterThan(1);
  expect(initial.max).toBe(4);
  // An edit that grows the content and bounds does not move the view.
  await page.evaluate(async () => {
    const doc = structuredClone((window as unknown as { __doc: LevelDoc }).__doc);
    const first = doc.buildings[0]!;
    doc.buildings.push({ ...first, id: 'extra', pos: { x: first.pos.x + 8, z: first.pos.z + 3 } });
    doc.bounds = { ...doc.bounds, maxX: doc.bounds.maxX + 8 };
    await window.__editorViewport!.setDocument(doc);
  });
  const edited = await read();
  expect(edited.zoom).toBe(initial.zoom);
  expect(edited.pos).toEqual(initial.pos);
  // Wheel keeps the ground point under the cursor within 2px.
  const cursor = { x: 240 + 300, y: 100 + 400 };
  const groundBefore = await page.evaluate(({ x, y }) => window.__editorViewport!.groundAt(x, y)!, cursor);
  const zoom0 = (await read()).zoom;
  await page.mouse.move(cursor.x, cursor.y); await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await read()).zoom).toBeGreaterThan(zoom0);
  const projected = await page.evaluate(({ x, y, g }) => {
    const s = window.__editorViewport!.inspection!, q = s.camera.position.clone().set(g.x, 0, g.z).applyMatrix4(s.worldRoot.matrixWorld).project(s.camera), r = s.canvas.getBoundingClientRect();
    return { x: r.left + (q.x + 1) * r.width / 2 - x, y: r.top + (1 - q.y) * r.height / 2 - y };
  }, { ...cursor, g: groundBefore });
  expect(Math.abs(projected.x)).toBeLessThan(2); expect(Math.abs(projected.y)).toBeLessThan(2);
  // Zoom stops at the limits.
  await page.evaluate(() => window.__editorViewport!.zoomBy(1000));
  let v = await read(); expect(v.zoom).toBe(4); expect(v.atMax).toBe(true);
  await page.evaluate(() => window.__editorViewport!.zoomBy(1e-6));
  v = await read(); expect(v.zoom).toBeCloseTo(v.min, 6); expect(v.atMin).toBe(true); expect(v.min).toBeLessThan(1);
  // Fit area shows the whole 40x30 area.
  await page.evaluate(() => window.__editorViewport!.zoomBy(2)); await page.evaluate(() => window.__editorViewport!.fitArea());
  const corners = await page.evaluate(() => {
    const doc = (window as unknown as { __doc: LevelDoc }).__doc, s = window.__editorViewport!.inspection!, r = s.canvas.getBoundingClientRect();
    const cx = Math.round((doc.bounds.minX + doc.bounds.maxX) * 2) / 4, cz = Math.round((doc.bounds.minZ + doc.bounds.maxZ) * 2) / 4;
    return [[-20, -15], [20, -15], [20, 15], [-20, 15]].map(([dx, dz]) => {
      const q = s.camera.position.clone().set(cx + dx!, 0, cz + dz!).applyMatrix4(s.worldRoot.matrixWorld).project(s.camera);
      return { x: r.left + (q.x + 1) * r.width / 2, y: r.top + (1 - q.y) * r.height / 2, r: { l: r.left, t: r.top, w: r.width, h: r.height } };
    });
  });
  for (const c of corners) { expect(c.x).toBeGreaterThanOrEqual(c.r.l); expect(c.x).toBeLessThanOrEqual(c.r.l + c.r.w); expect(c.y).toBeGreaterThanOrEqual(c.r.t); expect(c.y).toBeLessThanOrEqual(c.r.t + c.r.h); }
  expect((await read()).atMin).toBe(true);
  // Game camera is zoom 1.
  await page.evaluate(() => window.__editorViewport!.gameCamera());
  expect((await read()).zoom).toBe(1);
  // Blank doc: same semantics, default zoom above 1.
  const blank = await page.evaluate(async () => {
    const doc = structuredClone((window as unknown as { __doc: LevelDoc }).__doc);
    doc.id = 'na-blank'; doc.buildings = []; doc.elements = [];
    await window.__editorViewport!.setDocument(doc);
    return window.__editorViewport!.viewState;
  });
  console.log(`default zoom blank: ${blank.zoom.toFixed(3)} (min ${blank.min.toFixed(3)} max ${blank.max})`);
  testInfo.annotations.push({ type: 'default-zoom-blank', description: blank.zoom.toFixed(3) });
  expect(blank.zoom).toBeGreaterThan(1);
  await page.evaluate(() => window.__editorViewport!.zoomBy(1000));
  expect((await page.evaluate(() => window.__editorViewport!.viewState)).atMax).toBe(true);
});

test('pan gestures: hand mode, Space, middle/right drag, marquee with hand off, grid overlay', async ({ page }) => {
  test.skip(!development, 'Uses dev module imports and local API');
  test.setTimeout(120000);
  await page.goto('/editor.html');
  await page.evaluate(async () => {
    const path = '/src/editor/viewport-engine.ts';
    const { createEditorViewport } = await import(/* @vite-ignore */ path) as typeof import('../src/editor/viewport-engine.js');
    const host = document.createElement('div');
    host.id = 'viewport-fixture'; host.className = 'editor-workspace';
    Object.assign(host.style, { position: 'absolute', left: '240px', top: '100px', width: '900px', height: '650px' });
    document.body.append(host);
    window.__editorSelection = [];
    window.__editorViewport = createEditorViewport(host, { selection: items => { window.__editorSelection = items; } });
    const doc = await (await fetch('/__editor/level/na-trial')).json() as LevelDoc;
    const model = '/src/editor/model.ts';
    const { buildableArea } = await import(/* @vite-ignore */ model) as typeof import('../src/editor/model.js');
    window.__editorViewport.setArea(buildableArea(doc.bounds));
    await window.__editorViewport.setDocument(doc);
  });
  const cam = () => page.evaluate(() => window.__editorViewport!.inspection!.camera.position.toArray());
  const drag = async (button: 'left' | 'middle' | 'right') => {
    const before = await cam();
    await page.mouse.move(600, 400); await page.mouse.down({ button });
    await page.mouse.move(560, 380, { steps: 4 }); await page.mouse.up({ button });
    return { before, after: await cam() };
  };
  // Pan must not change selection, even when pressing on an item: select b0 first, then pan from empty/any spot.
  await page.evaluate(() => window.__editorViewport!.select([{ kind: 'building', id: 'b0' }]));
  await page.evaluate(() => window.__editorViewport!.zoomBy(1.5));
  let r = await drag('middle'); expect(r.after).not.toEqual(r.before);
  r = await drag('right'); expect(r.after).not.toEqual(r.before);
  // Hand off: left drag on empty = marquee, camera static.
  await page.mouse.move(245, 105); await page.mouse.down(); await page.mouse.move(1135, 745, { steps: 5 });
  await expect(page.locator('.editor-marquee:visible')).toHaveCount(1);
  await page.mouse.up();
  expect(await page.evaluate(() => window.__editorSelection!.length)).toBeGreaterThan(0);
  // Hand on: left drag pans, selection unchanged.
  await page.evaluate(() => window.__editorViewport!.select([{ kind: 'building', id: 'b0' }]));
  await page.evaluate(() => window.__editorViewport!.setHand(true));
  expect(await page.locator('#viewport-fixture').evaluate(e => e.style.cursor)).toBe('grab');
  r = await drag('left'); expect(r.after).not.toEqual(r.before);
  expect(await page.evaluate(() => window.__editorSelection)).toEqual([{ kind: 'building', id: 'b0' }]);
  await expect(page.locator('.editor-marquee:visible')).toHaveCount(0);
  await page.evaluate(() => window.__editorViewport!.setHand(false));
  // Space held (over canvas): left drag pans.
  await page.evaluate(() => window.__editorViewport!.setSpace(true)); // key wiring lives in Viewport.tsx; engine seam here
  expect(await page.locator('#viewport-fixture').evaluate(e => e.style.cursor)).toBe('grab');
  r = await drag('left'); expect(r.after).not.toEqual(r.before);
  await page.evaluate(() => window.__editorViewport!.setSpace(false));
  expect(await page.locator('#viewport-fixture').evaluate(e => e.style.cursor)).toBe('');
  // Grid overlay.
  await expect(page.locator('.editor-grid-line')).toHaveCount(0);
  await page.evaluate(() => window.__editorViewport!.setGrid(true));
  expect(await page.locator('.editor-grid-line').count()).toBeGreaterThan(40);
  expect(await page.locator('.editor-grid-major').count()).toBeGreaterThan(0);
  await page.evaluate(() => window.__editorViewport!.fitArea()); // 40x30 area at fit: spacing may fall under 8px
  await page.evaluate(() => window.__editorViewport!.setGrid(false));
  await expect(page.locator('.editor-grid-line')).toHaveCount(0);
});

test('Space key in the editor pans only while the pointer is over the canvas', async ({ page }) => {
  test.skip(!development, 'Dev-only editor');
  await openCopied(page);
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  const ws = page.locator('.editor-workspace'), box = (await ws.boundingBox())!;
  // Create closes beneath the pointer; establish a fresh canvas entry for shortcuts.
  await page.mouse.move(2, 2);
  await page.mouse.move(box.x + 50, box.y + 50);
  await page.keyboard.down('Space');
  expect(await ws.evaluate(e => (e as HTMLElement).style.cursor)).toBe('grab');
  await page.keyboard.up('Space');
  expect(await ws.evaluate(e => (e as HTMLElement).style.cursor)).toBe('');
  await page.mouse.move(2, 2);
  await page.keyboard.down('Space');
  expect(await ws.evaluate(e => (e as HTMLElement).style.cursor)).toBe('');
  await page.keyboard.up('Space');
});

test('canvas controls: zoom limits, fit, game camera, hand, persisted grid', async ({ page }) => {
  test.skip(!development, 'Editor API is dev-only');
  test.setTimeout(120000);
  await page.goto('/editor.html');
  await page.evaluate(() => localStorage.removeItem('node-arena.editor.grid'));
  await page.getByLabel('New level id').fill('na-canvas-ctl');
  await page.getByTestId('create-confirm').click();
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  const controls = page.getByTestId('canvas-controls');
  for (const name of ['Zoom out', 'Zoom in', 'Fit area', 'Game camera', 'Hand', 'Show grid']) {
    const b = controls.getByRole('button', { name, exact: true });
    await expect(b).toBeVisible(); await expect(b).toHaveAttribute('title', name);
  }
  await expect(controls).toHaveAttribute('role', 'group');
  await expect(controls).toHaveAccessibleName('Canvas controls');
  expect(await controls.getByRole('button').evaluateAll(buttons => buttons.map(b => b.getAttribute('aria-label'))))
    .toEqual(['Zoom in', 'Zoom out', 'Fit area', 'Game camera', 'Hand', 'Show grid']);
  const canvasBox = (await page.locator('.ed-canvas').boundingBox())!;
  const controlBox = (await controls.boundingBox())!;
  expect(controlBox.y - canvasBox.y).toBeCloseTo(12, 1);
  expect(canvasBox.x + canvasBox.width - controlBox.x - controlBox.width).toBeCloseTo(12, 1);
  const buttons = controls.getByRole('button');
  const buttonBoxes = await Promise.all((await buttons.all()).map(async button => (await button.boundingBox())!));
  for (const [i, box] of buttonBoxes.entries()) {
    expect(box.x).toBeCloseTo(controlBox.x, 1);
    expect(box.width).toBeCloseTo(36, 1);
    expect(box.height).toBeCloseTo(36, 1);
    if (i > 0) expect(box.y).toBeGreaterThan(buttonBoxes[i - 1]!.y);
  }
  const cards = controls.locator('.canvas-card');
  await expect(cards).toHaveCount(5);
  const cardBoxes = await Promise.all((await cards.all()).map(async card => (await card.boundingBox())!));
  for (const [i, box] of cardBoxes.entries()) {
    expect(box.x).toBeCloseTo(controlBox.x, 1);
    expect(box.width).toBeCloseTo(36, 1);
    expect(box.height).toBeCloseTo(i === 0 ? 72 : 36, 1);
    if (i > 0) expect(box.y - cardBoxes[i - 1]!.y - cardBoxes[i - 1]!.height).toBeCloseTo(8, 1);
    await expect(cards.nth(i).getByRole('button')).toHaveCount(i === 0 ? 2 : 1);
  }
  expect(buttonBoxes[1]!.y - buttonBoxes[0]!.y).toBeCloseTo(36, 1);
  expect(controlBox.height).toBeCloseTo(248, 1);
  const zin = controls.getByRole('button', { name: 'Zoom in', exact: true }), zout = controls.getByRole('button', { name: 'Zoom out', exact: true });
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Game camera', exact: true })).toHaveCount(1);
  await controls.getByRole('button', { name: 'Fit area', exact: true }).click();
  for (let i = 0; i < 40 && await zin.isEnabled(); i++) await zin.click();
  await expect(zin).toBeDisabled(); await expect(zout).toBeEnabled();
  for (let i = 0; i < 80 && await zout.isEnabled(); i++) await zout.click();
  await expect(zout).toBeDisabled(); await expect(zin).toBeEnabled();
  await zin.click(); await expect(zout).toBeEnabled();
  await controls.getByRole('button', { name: 'Game camera', exact: true }).click();
  await controls.getByRole('button', { name: 'Fit area', exact: true }).click();
  const hand = controls.getByRole('button', { name: 'Hand', exact: true }), workspace = page.getByLabel('Edit viewport');
  await expect(hand).toHaveAttribute('aria-pressed', 'false');
  await hand.click();
  await expect(hand).toHaveAttribute('aria-pressed', 'true');
  await expect(workspace).toHaveCSS('cursor', 'grab');
  await hand.click();
  await expect(workspace).not.toHaveCSS('cursor', 'grab');
  const grid = controls.getByRole('button', { name: 'Show grid', exact: true });
  await expect(grid).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.editor-grid-line')).toHaveCount(0);
  await grid.click();
  await expect(grid).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('.editor-grid-line').count()).toBeGreaterThan(0);
  await page.goto('/editor.html?level=na-trial');
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  await expect(controls.getByRole('button', { name: 'Show grid', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('.editor-grid-line').count()).toBeGreaterThan(0);
});
