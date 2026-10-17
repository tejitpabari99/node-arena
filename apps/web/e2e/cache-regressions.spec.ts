import { expect, test } from '@playwright/test';
import { mirroredUvGlb } from './fixtures/model-regressions';

test('application restarts and twenty shared-source switches retain decoded CPU assets without retired GPU owners', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Actual controller/runtime source imports require Vite development server');
  test.setTimeout(120000);
  let offline = false, models = 0, audio = 0;
  const wav = Buffer.alloc(60); wav.write('RIFF'); wav.writeUInt32LE(52, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16, 40);
  await page.goto('/');
  const texture = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; canvas.getContext('2d')!.fillRect(0, 0, 1, 1); return canvas.toDataURL(); });
  await page.route('**/models/cache.glb', route => { models++; return offline ? route.abort() : route.fulfill({ body: mirroredUvGlb(texture), contentType: 'model/gltf-binary' }); });
  await page.route('**/audio/cache.wav', route => { audio++; return offline ? route.abort() : route.fulfill({ body: wav, contentType: 'audio/wav' }); });
  await page.evaluate(async () => {
    const statePath = '/src/app/state.ts', runtimePath = '/src/app/runtime.ts', bootPath = '/src/app/boot.ts', fixturePath = '/src/test-harness/fixtures.ts', assetsPath = '/src/manifest/assets.ts';
    const { createAppController } = await import(statePath), { createBrowserRuntime } = await import(runtimePath), { contentFiles } = await import(bootPath), { fixtureFiles } = await import(fixturePath), { AssetManager } = await import(assetsPath);
    const manifest = await (await fetch('/manifest.json')).json(); for (const v of Object.values<any>(manifest.visuals)) v.model = v.kind === 'tower' ? 'block' : 'unit'; manifest.models.block = manifest.models.unit = { src: 'models/cache.glb' }; for (const theme of Object.values<any>(manifest.themes)) theme.props = []; /* theme props load their own models; this test counts only the shared source */ for (const event of Object.values<any>(manifest.events)) if (event.sfx) event.sfx = 'audio/cache.wav'; manifest.events.Captured.sfx = 'audio/cache.wav';
    const parent = document.createElement('div'); parent.style.cssText = 'width:640px;height:360px'; document.body.replaceChildren(parent);
    const audioContext = new AudioContext(); let decodes = 0, manager: any; const retired: any[] = [];
    const app = createAppController({ files: fixtureFiles(contentFiles(), 'normal'), autoStart: false, loadManifest: async () => manifest,
      createAssetManager: (manifest: any) => manager = new AssetManager(manifest, { audioContext: { decodeAudioData(bytes: ArrayBuffer) { decodes++; return audioContext.decodeAudioData(bytes); } } }),
      createRuntime: (context: any) => { const runtime = createBrowserRuntime(context, parent, app.snapshot().save.settings), inspection = runtime.inspection as any;
        const dispose = runtime.dispose; runtime.dispose = () => { dispose(); retired.push(inspection.renderer); }; return runtime; } });
    await app.boot(); app.updateSettings({ quality: 'low', reducedMotion: true }); await app.startLevel('fixture-1');
    if (app.snapshot().screen !== 'playing') throw Error(JSON.stringify(app.snapshot().error));
    app.driver!.submit({ type: 'DrawLine', player: 'p1', from: 't1', to: 't2' }); app.step(40);
    const source = app.assetSession!.models.get('block')!, sourceMeshes: any[] = []; source.traverse((node: any) => { if (node.isMesh) sourceMeshes.push(node); });
    const audioBuffer = app.assetSession!.audio.get('audio/cache.wav');
    let geometryDisposals = 0, textureDisposals = 0; const geometries = new Set<any>(), textures = new Set<any>();
    for (const mesh of sourceMeshes) { geometries.add(mesh.geometry); for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) for (const value of Object.values(material)) if ((value as any)?.isTexture) textures.add(value); }
    geometries.forEach(geometry => geometry.addEventListener('dispose', () => geometryDisposals++)); textures.forEach(texture => texture.addEventListener('dispose', () => textureDisposals++));
    Object.assign(window, { cacheApp: { app, manager, audioContext, parent, retired, source, audioBuffer, geometries, textures, baseline: { ...(app.runtime!.inspection as any).renderer.info.memory }, decodes: () => decodes, disposals: () => ({ geometryDisposals, textureDisposals }) } });
  });
  expect(models).toBe(1); expect(audio).toBe(1); offline = true;
  const result = await page.evaluate(async () => {
    const state = (window as any).cacheApp, { app, manager, source, audioBuffer } = state;
    const current: any[] = []; let retainedIdentity = true;
    await app.restart();
    for (let i = 1; i <= 20; i++) {
      await app.startLevel(`fixture-${i}`); if (app.snapshot().screen !== 'playing') throw Error(JSON.stringify(app.snapshot().error));
      app.driver.submit({ type: 'DrawLine', player: 'p1', from: 't1', to: 't2' }); app.step(40);
      retainedIdentity &&= app.assetSession.models.get('block') === source && app.assetSession.audio.get('audio/cache.wav') === audioBuffer;
      current.push({ ...(app.runtime.inspection as any).renderer.info.memory });
    }
    const listenerCount = (resource: any) => resource._listeners?.dispose?.length ?? 0;
    const sourceListeners = [...state.geometries, ...state.textures].map(listenerCount);
    const before = state.disposals(), cached = manager.cachedSources;
    app.menu(); const retired = state.retired.map((renderer: any) => ({ ...renderer.info.memory, contextLost: renderer.getContext().isContextLost() }));
    app.dispose(); await state.audioContext.close();
    return { baseline: state.baseline, current, retainedIdentity, decodes: state.decodes(), cached, after: manager.cachedSources, before, disposed: state.disposals(), sourceListeners, sourceGeometryCount: state.geometries.size, sourceTextureCount: state.textures.size, retired, labels: state.parent.querySelectorAll('[data-tower-index]').length, canvases: state.parent.querySelectorAll('canvas').length };
  });
  expect(models).toBe(1); expect(audio).toBe(1); expect(result.decodes).toBe(1); expect(result.retainedIdentity).toBe(true);
  expect(result.cached).toBe(2); expect(result.after).toBe(0); expect(result.before).toEqual({ geometryDisposals: 0, textureDisposals: 0 });
  expect(result.disposed).toEqual({ geometryDisposals: result.sourceGeometryCount, textureDisposals: result.sourceTextureCount });
  // One test census listener per CPU original; no renderer/context listeners accumulate.
  expect(result.sourceListeners.every((count: number) => count === 1)).toBe(true);
  expect(result.current.every((memory: unknown) => JSON.stringify(memory) === JSON.stringify(result.baseline))).toBe(true);
  // Three's internally owned fallback environment texture remains in retired info counters.
  expect(result.retired).toEqual(result.retired.map(() => ({ geometries: 0, textures: 1, contextLost: true })));
  expect(result.labels).toBe(0); expect(result.canvases).toBe(0);
  await test.info().attach('cache-retention-lifetime.json', { body: JSON.stringify({ ...result, requests: { models, audio } }), contentType: 'application/json' });
});


test('production shell retains GLB and WAV across offline restart and shared-source level switches', async ({ page }) => {
  test.setTimeout(120000);
  let offline = false, models = 0, audio = 0;
  const wav = Buffer.alloc(60); wav.write('RIFF'); wav.writeUInt32LE(52, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16, 40);
  const { syntheticGlb } = await import('./fixtures/model');
  await page.addInitScript(() => {
    (window as any).cacheDecodes = 0;
    const original = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = function (...args: Parameters<typeof original>) { (window as any).cacheDecodes++; return Reflect.apply(original, this, args); };
  });
  await page.route('**/manifest.json', async route => {
    const manifest = await (await route.fetch()).json(); for (const v of Object.values<any>(manifest.visuals)) v.model = v.kind === 'tower' ? 'block' : 'unit'; for (const key of Object.keys(manifest.models)) manifest.models[key] = { src: 'models/offline.glb' }; for (const event of Object.values<any>(manifest.events)) if (event.sfx) event.sfx = 'audio/offline.wav'; manifest.events.Captured.sfx = 'audio/offline.wav';
    await route.fulfill({ json: manifest });
  });
  await page.route('**/models/offline.glb', route => { models++; return offline ? route.abort() : route.fulfill({ body: syntheticGlb(), contentType: 'model/gltf-binary' }); });
  await page.route('**/audio/offline.wav', route => { audio++; return offline ? route.abort() : route.fulfill({ body: wav, contentType: 'audio/wav' }); });
  await page.goto('/?test=1&fixture=normal');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await page.evaluate(async () => { window.__na!.settings({ quality: 'low', reducedMotion: true }); await window.__na!.load('fixture-1'); window.__na!.submit({ type: 'DrawLine', player: 'p1', from: 't1', to: 't2' }); window.__na!.step(40); });
  await expect(page.locator('main')).toHaveAttribute('data-screen', 'playing');
  const baseline = await page.evaluate(() => window.__na!.memory().current);
  expect(models).toBe(1); expect(audio).toBe(1); offline = true;
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('data-screen', 'playing');
  for (let i = 1; i <= 20; i++) {
    await page.evaluate(async id => { await window.__na!.load(id); window.__na!.submit({ type: 'DrawLine', player: 'p1', from: 't1', to: 't2' }); window.__na!.step(40); }, `fixture-${i}`);
    await expect(page.locator('main')).toHaveAttribute('data-screen', 'playing');
    expect(await page.evaluate(() => window.__na!.memory().current)).toEqual(baseline);
  }
  expect(models).toBe(1); expect(audio).toBe(1); expect(await page.evaluate(() => (window as any).cacheDecodes)).toBe(1);
  await page.evaluate(() => window.__na!.menu());
  const memory = await page.evaluate(() => window.__na!.memory());
  expect(memory.retired).toEqual(memory.retired.map(() => ({ geometries: 0, textures: 1, contextLost: true })));
  expect(memory.labels).toBe(0); expect(memory.canvases).toBe(0);
  await test.info().attach('production-offline-cache.json', { body: JSON.stringify({ baseline, memory, requests: { models, audio }, decodes: 1 }), contentType: 'application/json' });
});
