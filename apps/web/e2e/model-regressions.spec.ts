import { expect, test } from '@playwright/test';
import { mirroredUvGlb } from './fixtures/model-regressions.js';

test('actual GLB troops preserve mirrored exteriors and authored secondary texture sampling', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Isolated renderer source imports require Vite development server');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  const textureUri = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 1;
    const context = canvas.getContext('2d')!; context.fillStyle = '#ff0000'; context.fillRect(0, 0, 1, 1); context.fillStyle = '#00ff00'; context.fillRect(1, 0, 1, 1);
    return canvas.toDataURL('image/png');
  });
  await page.route('**/models/mirrored-uv.glb', route => route.fulfill({ body: mirroredUvGlb(textureUri), contentType: 'model/gltf-binary' }));
  const result = await page.evaluate(async () => {
    const assetsPath = '/src/manifest/assets.ts', troopsPath = '/src/render/troops.ts', scopePath = '/src/render/disposables.ts', threePath = '/node_modules/.vite/deps/three.js';
    const { AssetManager } = await import(assetsPath), { createTroopRenderer } = await import(troopsPath), { Disposables } = await import(scopePath);
    const { Scene, OrthographicCamera, WebGLRenderer, Vector3, FrontSide } = await import(threePath);
    const manifest = await (await fetch('/manifest.json')).json();
    manifest.models = { fixture: { src: 'models/mirrored-uv.glb' } };
    manifest.visuals = { fixture: { kind: 'troop', model: 'fixture', scale: 1, teamMaterial: 'Accent', anim: { type: 'none' } } };
    manifest.palettes.default['player.1'] = '#ffffff';
    const manager = new AssetManager(manifest), session = manager.createSession({ models: new Set(['fixture']), visuals: new Set(['fixture']), audio: new Set(), sources: new Set() });
    await session.load(); if (session.state !== 'ready') throw session.failures[0];
    const sim = { view: { towerStatic: [{ x: 0, y: 0 }, { x: 0, y: 10000 }], kinds: [{ visual: 'fixture', speedPerTick: 0 }], players: [{ colorKey: 'player.1' }] },
      readTroops(buf: any) { buf.channel[0] = 1; buf.seq[0] = 0; buf.owner[0] = 0; buf.kind[0] = 0; buf.progress[0] = 0; return 1; } };
    const scene = new Scene(), scope = new Disposables(), troops = createTroopRenderer({ sim, scene, scope, manifest, models: session.models }); troops.update(0, 0);
    const renderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: true }); renderer.setSize(400, 200); renderer.setClearColor(0x000000);
    document.body.replaceChildren(renderer.domElement);
    const camera = new OrthographicCamera(-4, 4, 2, -2, .1, 100); camera.position.set(0, 1, 10); camera.lookAt(0, 1, 0); renderer.render(scene, camera);
    function sample(x: number) { const point = new Vector3(x, .6, 0).project(camera), pixel = new Uint8Array(4), gl = renderer.getContext(); gl.readPixels(Math.floor((point.x + 1) * 200), Math.floor((point.y + 1) * 100), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); return Array.from(pixel); }
    const front = [-1.5, 1.5].map(sample), material = troops.meshes[0].material[0], channel = material.map.channel, side = material.side;
    camera.position.z = -10; camera.lookAt(0, 1, 0); renderer.render(scene, camera); const back = [-1.5, 1.5].map(sample);
    scope.dispose(); session.dispose(); manager.dispose(); renderer.dispose(); return { front, back, channel, singleSided: side === FrontSide };
  });
  console.log(`MODEL_REGRESSIONS ${JSON.stringify(result)}`);
  expect(errors).toEqual([]); expect(result.channel).toBe(1); expect(result.singleSided).toBe(true);
  for (const pixel of result.front) { expect(pixel[1]).toBeGreaterThan(240); expect(pixel[0]).toBeLessThan(10); expect(pixel[2]).toBeLessThan(10); }
  for (const pixel of result.back) expect(pixel.slice(0, 3)).toEqual([0, 0, 0]);
});
