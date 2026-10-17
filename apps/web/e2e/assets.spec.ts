import { expect, test } from '@playwright/test';

// Source imports let this isolated lifecycle check exercise modules before the main UI wires them.
test('asset error recovery, real GLTF/audio decode, and twenty GPU resource releases', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Asset modules are not wired into the production shell until Task 12');
  let broken = true; let modelRequests = 0; let audioRequests = 0;
  const positions = new Float32Array([-1, 1, 0, 1, 1, 0, 0, 3, 0]);
  const gltf = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: positions.byteLength, uri: `data:application/octet-stream;base64,${Buffer.from(positions.buffer).toString('base64')}` }],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, 1, 0], max: [1, 3, 0] }] };
  const wav = Buffer.alloc(60); wav.write('RIFF'); wav.writeUInt32LE(52, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16, 40);
  await page.route('**/models/test.gltf', route => { modelRequests++; return route.fulfill({ json: gltf }); });
  await page.route('**/audio/test.wav', route => { audioRequests++; return broken ? route.fulfill({ status: 503 }) : route.fulfill({ body: wav, contentType: 'audio/wav' }); });
  await page.goto('/');
  // Vite may reload once when these not-yet-wired addon dependencies are optimized.
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await page.evaluate(async () => { const path = '/src/manifest/assets.ts'; await import(path); }); break; }
    catch (error) { if (!(error instanceof Error) || !error.message.includes('Execution context was destroyed')) throw error; await page.waitForLoadState('networkidle'); }
  }
  const failed = await page.evaluate(async () => {
    const assetsPath = '/src/manifest/assets.ts'; const { AssetManager } = await import(assetsPath);
    const manifest = await (await fetch('/manifest.json')).json(); manifest.models = { test: { src: 'models/test.gltf' } };
    const manager = new AssetManager(manifest); const keys = { models: new Set(['test']), visuals: new Set(), audio: new Set(['audio/test.wav']), sources: new Set() };
    const session = manager.createSession(keys); await session.load();
    Object.assign(window, { assetTest: { manager, session } });
    return { state: session.state, error: session.failures.map((error: Error & { key: string; src: string }) => ({ name: error.name, key: error.key, src: error.src })) };
  });
  expect(failed).toEqual({ state: 'error', error: [{ name: 'AssetError', key: 'audio/test.wav', src: 'audio/test.wav' }] });
  expect(modelRequests).toBe(1); expect(audioRequests).toBe(3); broken = false;
  const recovered = await page.evaluate(async () => {
    const state = (window as unknown as { assetTest: { session: { retryFailed(): Promise<void>; state: string; audio: Map<string, AudioBuffer>; dispose(): void }; manager: { dispose(): void } } }).assetTest;
    await state.session.retryFailed(); const result = { state: state.session.state, samples: state.session.audio.get('audio/test.wav')!.length };
    state.session.dispose(); state.manager.dispose(); return result;
  });
  expect(recovered.state).toBe('ready'); expect(recovered.samples).toBeGreaterThan(0); expect(modelRequests).toBe(1); expect(audioRequests).toBe(4);
  const memory = await page.evaluate(async () => {
    const assetsPath = '/src/manifest/assets.ts'; const modelPath = '/src/render/model.ts'; const scopePath = '/src/render/disposables.ts'; const threePath = '/node_modules/.vite/deps/three.js';
    const { AssetManager } = await import(assetsPath); const { cloneModel } = await import(modelPath); const { Disposables } = await import(scopePath);
    const { WebGLRenderer, Scene, PerspectiveCamera, AmbientLight } = await import(threePath);
    const renderer = new WebGLRenderer(); renderer.setSize(100, 100); const scene = new Scene(); const camera = new PerspectiveCamera(45, 1, .1, 100); camera.position.set(0, 2, 6); scene.add(new AmbientLight());
    const manifest = await (await fetch('/manifest.json')).json(); manifest.models = { test: { primitive: 'box', size: [1, 2, 1] } };
    const manager = new AssetManager(manifest); renderer.render(scene, camera); let baseline = { ...renderer.info.memory };
    for (let i = 0; i < 21; i++) {
      const session = manager.createSession({ models: new Set(['test']), visuals: new Set(), audio: new Set(), sources: new Set() }); await session.load();
      const scope = new Disposables(); scene.add(cloneModel(session.models.get('test'), scope)); renderer.render(scene, camera);
      scope.dispose(); session.dispose(); renderer.render(scene, camera);
      // Standard materials lazily allocate a renderer-owned fallback environment texture.
      if (i === 0) baseline = { ...renderer.info.memory };
    }
    const after = { ...renderer.info.memory }; manager.dispose(); renderer.dispose(); return { baseline, after };
  });
  expect(memory.after).toEqual(memory.baseline);
});
