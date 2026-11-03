import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import type { EditorViewport } from '../../src/editor/viewport-engine.js';
import type { DocOp } from '../../src/editor/model.js';

declare global { interface Window { __spacingViewport: EditorViewport; __spacingEdits: DocOp[] } }
let server: ViteDevServer, browser: Browser, page: Page;
const domExpect = browserExpect.configure({ timeout: 10000 });
beforeAll(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-test-spacing', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(server.resolvedUrls!.local[0]! + 'editor.html');
  await page.evaluate(async () => {
    const viewportPath = '/src/editor/viewport-engine.ts', documentPath = '/src/editor/document.ts';
    const { createEditorViewport } = await (new Function('path', 'return import(path)'))(viewportPath) as typeof import('../../src/editor/viewport-engine.js');
    const { blankDocument } = await (new Function('path', 'return import(path)'))(documentPath) as typeof import('../../src/editor/document.js');
    const host = document.createElement('div'); host.id = 'spacing-host'; host.className = 'editor-workspace';
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '9999' }); document.body.append(host);
    window.__spacingEdits = [];
    window.__spacingViewport = createEditorViewport(host, { edit: op => window.__spacingEdits.push(op) });
    const doc = blankDocument('na-spacing', 'green', 'medium', () => 0);
    doc.buildings[0]!.pos = { x: -5, z: 0 }; doc.buildings[1]!.pos = { x: 5, z: 0 };
    await window.__spacingViewport.setDocument(doc);
    const tile = document.createElement('button'); tile.textContent = 'Spacing tower';
    Object.assign(tile.style, { position: 'fixed', left: '0', top: '0', zIndex: '10000' }); document.body.append(tile);
    tile.addEventListener('pointerdown', event => window.__spacingViewport.beginPlacement('tower', event.pointerId));
  });
}, 30000);
afterAll(async () => { await browser?.close(); await server?.close(); });
async function project(x: number, z: number) {
  return page.evaluate(async ({ x, z }) => {
    const path = '/node_modules/three/build/three.module.js';
    const { Vector3 } = await (new Function('path', 'return import(path)'))(path) as typeof import('three');
    const stage = window.__spacingViewport.inspection!;
    const p = new Vector3(x, 0, z).applyMatrix4(stage.worldRoot.matrixWorld).project(stage.camera), r = stage.canvas.getBoundingClientRect();
    return { x: r.left + (p.x + 1) * r.width / 2, y: r.top + (1 - p.y) * r.height / 2 };
  }, { x, z });
}
it('shows a blocked ghost and reverts a tower drag into the 3.5 exclusion area', async () => {
  const source = await project(-5, 0), invalid = await project(3, 0);
  await page.mouse.move(source.x, source.y); await page.mouse.down(); await page.mouse.move(invalid.x, invalid.y, { steps: 5 });
  await domExpect(page.locator('#spacing-host .editor-ghost-blocked')).toBeVisible();
  await page.mouse.up();
  expect(await page.evaluate(() => window.__spacingEdits)).toEqual([]);
  await domExpect(page.locator('#spacing-host .editor-ghost:not([hidden])')).toHaveCount(0);
});
it('blocks close library placement and permits a valid release', async () => {
  const invalid = await project(3, 0), valid = await project(0, 5);
  const tile = await page.getByRole('button', { name: 'Spacing tower', exact: true }).boundingBox();
  await page.mouse.move(tile!.x + tile!.width / 2, tile!.y + tile!.height / 2); await page.mouse.down();
  await page.mouse.move(invalid.x, invalid.y);
  await domExpect(page.locator('#spacing-host .editor-ghost-blocked')).toBeVisible();
  await page.mouse.up();
  expect(await page.evaluate(() => window.__spacingEdits)).toEqual([]);
  await page.mouse.move(tile!.x + tile!.width / 2, tile!.y + tile!.height / 2); await page.mouse.down();
  await page.mouse.move(valid.x, valid.y);
  await domExpect(page.locator('#spacing-host .editor-ghost:not([hidden])')).toBeVisible();
  await domExpect(page.locator('#spacing-host .editor-ghost-blocked')).toHaveCount(0);
  await page.mouse.up();
  expect(await page.evaluate(() => window.__spacingEdits)).toEqual([{ type: 'place', item: 'tower', pos: { x: 0, z: 5 } }]);
});
