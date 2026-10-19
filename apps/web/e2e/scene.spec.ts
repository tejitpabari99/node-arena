import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test('compiled level themes, real GL props, fixed fit through resize, live quality context changes and disposal', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Scene modules are not wired into the production shell until Task 12');
  const files = ['content.json', 'data/balance.json', 'data/levels/sample.json', 'data/troops/regular.json', 'data/archetypes/standard.json', 'data/archetypes/small.json', 'data/archetypes/large.json', 'data/examples/sample-bot.json'];
  const fileMap = Object.fromEntries(await Promise.all(files.map(async path => [path, await readFile(new URL(`../../../packages/content/${path}`, import.meta.url), 'utf8')])));
  const contentPath = `/@fs${fileURLToPath(new URL('../../../packages/content/src/index.ts', import.meta.url))}`;
  const positions = new Float32Array([-1, 0, 0, 1, 0, 0, 0, 3, 0]);
  await page.route('**/models/scene-test.gltf', route => route.fulfill({ json: {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: positions.byteLength, uri: `data:application/octet-stream;base64,${Buffer.from(positions.buffer).toString('base64')}` }],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, 0, 0], max: [1, 3, 0] }],
  } }));
  await page.goto('/');
  // Warm not-yet-wired addon imports before constructing state (Vite can reload once).
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await page.evaluate(async () => { const path = '/src/manifest/assets.ts'; await import(path); }); break; }
    catch (error) { if (!(error instanceof Error) || !error.message.includes('Execution context was destroyed')) throw error; await page.waitForLoadState('networkidle'); }
  }
  const result = await page.evaluate(async ({ fileMap, contentPath }) => {
    const scenePath = '/src/render/scene.ts', assetsPath = '/src/manifest/assets.ts', scopePath = '/src/render/disposables.ts', threePath = '/node_modules/.vite/deps/three.js';
    const { compileLevel, loadContent } = await import(contentPath); const { createLevelScene } = await import(scenePath);
    const { AssetManager } = await import(assetsPath); const { Disposables } = await import(scopePath); const { Vector3 } = await import(threePath);
    const loaded = loadContent(fileMap), authored = Object.values(loaded).find((entity: any) => 'towers' in entity) as any;
    const level = compileLevel(loaded, authored.id); const original = JSON.stringify(level);
    const manifest = await (await fetch('/manifest.json')).json(), theme = manifest.themes[level.visual];
    theme.fog = { color: '#123456', near: 20, far: 200 }; manifest.models.prop = { src: 'models/scene-test.gltf' };
    theme.props = [{ model: 'prop', pos: [20, 0, 20], scale: 2, rotation: [0, .5, 0] }, { model: 'block', pos: [5, 0, 5], scale: .5 }];
    const manager = new AssetManager(manifest), session = manager.createSession(manager.resolveLevelAssets(level)); await session.load();
    if (session.state !== 'ready') throw new Error('Fixture assets failed');
    const parent = document.createElement('div'); parent.style.cssText = 'width:800px;height:600px'; document.body.appendChild(parent);
    let changes = 0; const scope = new Disposables(); const view = createLevelScene({ level, manifest, models: session.models, parent, scope, quality: 'low', onCanvasChange: () => changes++ });
    const originalScene = view.scene, originalCamera = view.camera, originalCanvas = view.canvas;
    const themeState = { sky: `#${view.scene.background.getHexString()}`, ground: `#${view.ground.material.color.getHexString()}`, fog: `#${view.scene.fog.color.getHexString()}`,
      directionalLights: view.scene.children.filter((child: any) => child.isDirectionalLight).length, props: view.scene.children.filter((child: any) => child.type === 'Group').length,
      groundWidth: view.ground.geometry.parameters.width, groundDepth: view.ground.geometry.parameters.height };
    // SP03 T1 steep camera: shipped pitch 65 / fov 35; at 800x600 the top-centre ray stays >= 40 deg below the horizon.
    parent.style.width = '800px'; parent.style.height = '600px'; window.dispatchEvent(new Event('resize'));
    const centre = view.bounds.getCenter(new Vector3()), pitchDeg = Math.asin(view.camera.position.clone().sub(centre).normalize().y) * 180 / Math.PI;
    const topRay = new Vector3(0, 1, .5).unproject(view.camera).sub(view.camera.position).normalize(), topRayBelowHorizonDeg = -Math.asin(topRay.y) * 180 / Math.PI;
    const cameraState = { pitchDeg, fov: view.camera.fov, topRayBelowHorizonDeg, manifestCamera: manifest.camera, sandPlanes: view.scene.children.filter((child: any) => child.userData?.visualRole === 'ground' && child.geometry?.type === 'PlaneGeometry').length };
    const fit: number[] = [];
    for (const [width, height] of [[800, 600], [180, 900], [1200, 200]]) {
      parent.style.width = `${width}px`; parent.style.height = `${height}px`; window.dispatchEvent(new Event('resize')); view.render();
      for (const x of [view.bounds.min.x, view.bounds.max.x]) for (const y of [view.bounds.min.y, view.bounds.max.y]) for (const z of [view.bounds.min.z, view.bounds.max.z]) {
        const p = new Vector3(x, y, z).project(view.camera); fit.push(Math.abs(p.x), Math.abs(p.y));
      }
    }
    const qualities: any[] = []; const snapshot = () => { view.render(); qualities.push({ quality: view.quality, ratio: view.renderer.getPixelRatio(), shadows: view.renderer.shadowMap.enabled,
      size: view.light.shadow.mapSize.x, antialias: view.renderer.getContext().getContextAttributes().antialias, draws: view.renderer.info.render.calls }); };
    snapshot(); view.setQuality('med'); const medCanvas = view.canvas; snapshot(); view.setQuality('high'); snapshot();
    const medHighSameCanvas = medCanvas === view.canvas; view.setQuality('low'); snapshot();
    const retained = originalScene === view.scene && originalCamera === view.camera;
    const canvasReplaced = originalCanvas !== view.canvas && !originalCanvas.isConnected;
    view.dispose(); view.dispose(); session.dispose(); manager.dispose();
    const disposed = parent.children.length === 0; window.dispatchEvent(new Event('resize')); view.render(); parent.remove();
    return { cameraState, themeState, expectedTheme: theme, dimensions: { w: level.bounds.w / 1000, h: level.bounds.h / 1000 }, fit, qualities, changes, retained,
      canvasReplaced, medHighSameCanvas, disposed, unchanged: JSON.stringify(level) === original };
  }, { fileMap, contentPath });
  expect(result.themeState).toMatchObject({ sky: result.expectedTheme.sky.toLowerCase(), ground: result.expectedTheme.ground.toLowerCase(), fog: '#123456', directionalLights: 1, props: 2 });
  expect(result.themeState.groundWidth).toBeGreaterThanOrEqual(result.dimensions.w); expect(result.themeState.groundDepth).toBeGreaterThanOrEqual(result.dimensions.h);
  expect(result.cameraState.manifestCamera).toMatchObject({ pitchDeg: 65, fov: 35 });
  expect(result.cameraState.fov).toBe(35); expect(result.cameraState.pitchDeg).toBeCloseTo(65, 3);
  expect(result.cameraState.topRayBelowHorizonDeg).toBeGreaterThanOrEqual(40);
  expect(result.cameraState.sandPlanes).toBeGreaterThanOrEqual(2); // sand base + grass patch; no road slab
  expect(Math.max(...result.fit)).toBeLessThan(1);
  expect(result.qualities.map(q => [q.quality, q.ratio, q.shadows, q.size, q.antialias])).toEqual([
    ['low', 1, false, 1, false], ['med', 1.5, true, 1024, true], ['high', 1, true, 2048, true], ['low', 1, false, 1, false],
  ]);
  expect(result.qualities.every(q => q.draws > 0)).toBe(true); expect(result.changes).toBe(2);
  expect(result.retained && result.canvasReplaced && result.medHighSameCanvas && result.disposed && result.unchanged).toBe(true);
});
