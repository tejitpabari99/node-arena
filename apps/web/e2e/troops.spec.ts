import { fileURLToPath } from 'node:url';
const publicSimPath = `/@fs${fileURLToPath(new URL('../../../packages/sim/src/index.ts', import.meta.url))}`;
import path from 'node:path';
import { expect, test } from '@playwright/test';
test('real public sim: 2,000 troops, head-on placement, cut-channel persistence, GPU cleanup and shader correctness', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Production shell integration is Task 12; exercise renderer modules via Vite');
  test.setTimeout(180000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/manifest.json',route=>route.fulfill({path:path.join(process.cwd(),'test/fixtures/greybox-manifest.json'),contentType:'application/json'})); // primitive models: these specs build renderers directly from manifest keys
  await page.goto('/');
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await page.evaluate(async (simPath) => { for (const path of ['/src/render/troops.ts', '/src/render/disposables.ts', '/src/render/model.ts', '/node_modules/.vite/deps/three.js', simPath]) await import(path); }, publicSimPath); break; }
    catch (error) { if (!(error instanceof Error) || !error.message.includes('Execution context was destroyed')) throw error; await page.waitForLoadState('networkidle'); }
  }
  const result = await page.evaluate(async (simPath) => {
    const troopPath = '/src/render/troops.ts', scopePath = '/src/render/disposables.ts', modelPath = '/src/render/model.ts', threePath = '/node_modules/.vite/deps/three.js';
    const { createTroopRenderer } = await import(troopPath), { Disposables } = await import(scopePath), { createPrimitiveModel } = await import(modelPath), { create } = await import(simPath);
    const { Scene, PerspectiveCamera, WebGLRenderer, AmbientLight, DirectionalLight, Vector3, MeshBasicMaterial, MeshStandardMaterial, DataTexture } = await import(threePath);
    const manifest = await (await fetch('/manifest.json')).json();
    manifest.models.variant = { primitive: 'box', size: [.3, .7, .3] };
    manifest.visuals['fixture.variant'] = { kind: 'troop', model: 'variant', scale: 1, teamMaterial: 'shirt', tint: '#dddddd', anim: { type: 'bob', hz: 3, amp: .08, sway: 9 } };
    const visual = Object.entries(manifest.visuals).find(([, v]: any) => v.kind === 'troop')![0];
    function level(speed: number) { return { componentNames: ['capturable', 'drawsLines', 'garrison', 'generates'], id: 'fixture', timeLimitSec: 10000, visual: Object.keys(manifest.themes)[0], bots: [], bounds: { w: 40000, h: 20000 },
      players: [{ id: 'a', team: 'a', kind: 'human', colorKey: 'player.1' }, { id: 'b', team: 'b', kind: 'bot', colorKey: 'player.2' }],
      towers: [0, 1, 2, 3].map(i => ({ id: `t${i}`, x: i % 2 * 40000, y: Math.floor(i / 2) * 20000, owner: i % 2, garrison: 10000, archetype: 'fixture', visual: 'fixture', footprintRadius: 1000,
        components: { garrison: { cap: 20000 }, generates: { troop: Math.floor(i / 2), ratePerSec: 20000 }, drawsLines: { extraSlotAbove: [] }, capturable: {} } })),
      kinds: [{ id: 'fixture.one', value: 1, speedMilli: speed, visual }, { id: 'fixture.two', value: 1, speedMilli: speed, visual: 'fixture.variant' }] }; }
    const commands = [0, 1, 2, 3].map(i => ({ type: 'DrawLine', player: i % 2 ? 'b' : 'a', from: `t${i}`, to: `t${i ^ 1}` }));
    const models = new Map(Object.entries(manifest.models).filter(([, m]: any) => m.primitive).map(([key, model]) => [key, createPrimitiveModel(model)]));
    const variant = models.get('variant').children[0];
    const shirt = new MeshStandardMaterial({ map: new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1) }); shirt.name = 'shirt'; shirt.map.needsUpdate = true;
    const body = new MeshBasicMaterial({ color: '#cccccc' }); variant.material.dispose(); variant.material = [shirt, body, body, body, body, body];
    const scene = new Scene(), camera = new PerspectiveCamera(45, 640 / 360, .1, 200); camera.position.set(20, 40, 55); camera.lookAt(20, 0, 10);
    scene.add(new AmbientLight(0xffffff, 1.5)); const light = new DirectionalLight(0xffffff, 2); light.position.set(5, 20, 10); scene.add(light);
    const gl = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: true }); gl.setSize(640, 360); document.body.replaceChildren(gl.domElement);
    const scope = new Disposables(), sim = create(level(100), 42), troops = createTroopRenderer({ sim, scene, models, manifest, scope, initialCapacity: 8, lod: 'high' });
    sim.step(commands); for (let tick = 1; tick < 500; tick++) sim.step([]);
    troops.update(.5, 0); const count = troops.count;
    sim.step(commands.map((c: any) => ({ ...c, type: 'CutLine' }))); troops.update(.5, .1); const cutCount = troops.count, linesAfterCut = sim.view.lines.length;
    const samples: number[] = [], updates: number[] = [];
    for (let frame = 0; frame < 150; frame++) { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); const start = performance.now(); troops.update(.5, frame / 60); const updated = performance.now(); gl.render(scene, camera); const end = performance.now(); if (frame >= 30) { samples.push(end - start); updates.push(updated - start); } }
    const calls = gl.info.render.calls, triangles = gl.info.render.triangles;
    const pixels = new Uint8Array(640 * 360 * 4); gl.getContext().readPixels(0, 0, 640, 360, gl.getContext().RGBA, gl.getContext().UNSIGNED_BYTE, pixels);
    let colored = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! + pixels[i + 1]! + pixels[i + 2]! > 10) colored++;
    const projected = new Vector3(0, 0, 0).project(camera).toArray();
    scope.dispose(); gl.render(scene, camera); const baseline = { ...gl.info.memory };
    const headSim = create(level(20000), 3); headSim.step(commands); for (let i = 1; i < 20; i++) headSim.step([]);
    const headScope = new Disposables(), head = createTroopRenderer({ sim: headSim, scene, models, manifest, scope: headScope, lod: 'high' }); head.update(1, 0);
    const fronts = head.meshes.filter((mesh: any) => mesh.userData.lod === 'high').map((mesh: any) => Array.from(mesh.geometry.getAttribute('troopPose').array.slice(0, 4)) as number[]);
    gl.render(scene, camera);
    const headVisible = [0, 20].map(z => { const ndc = new Vector3(20, .5, z).project(camera), x = Math.round((ndc.x + 1) * 320), y = Math.round((ndc.y + 1) * 180); const region = new Uint8Array(12 * 12 * 4); gl.getContext().readPixels(x - 6, y - 6, 12, 12, gl.getContext().RGBA, gl.getContext().UNSIGNED_BYTE, region); let visible = 0; for (let i = 0; i < region.length; i += 4) if (region[i]! + region[i + 1]! + region[i + 2]! > 10) visible++; return visible; });
    headScope.dispose(); gl.render(scene, camera);
    // Low LOD pass: same placement (pixels at the same two points), drawn from the low set only, 2,000 troops.
    const lowScope = new Disposables(), low = createTroopRenderer({ sim: headSim, scene, models, manifest, scope: lowScope, lod: 'low' }); low.update(1, 0); gl.render(scene, camera);
    const lowVisible = [0, 20].map(z => { const ndc = new Vector3(20, .5, z).project(camera), x = Math.round((ndc.x + 1) * 320), y = Math.round((ndc.y + 1) * 180); const region = new Uint8Array(12 * 12 * 4); gl.getContext().readPixels(x - 6, y - 6, 12, 12, gl.getContext().RGBA, gl.getContext().UNSIGNED_BYTE, region); let visible = 0; for (let i = 0; i < region.length; i += 4) if (region[i]! + region[i + 1]! + region[i + 2]! > 10) visible++; return visible; });
    const lowDraw = low.meshes.filter((mesh: any) => mesh.count > 0).every((mesh: any) => mesh.userData.lod === 'low') && low.lod === 'low';
    lowScope.dispose(); gl.render(scene, camera);
    const bigScope = new Disposables(), big = createTroopRenderer({ sim, scene, models, manifest, scope: bigScope, initialCapacity: 8 }); big.update(.5, 0); gl.render(scene, camera); // auto at 2,000 live -> low only
    const autoBig = { lod: big.lod, high: big.meshes.filter((m: any) => m.userData.lod === 'high').reduce((n: number, m: any) => n + m.count, 0), low: big.meshes.filter((m: any) => m.userData.lod === 'low').reduce((n: number, m: any) => n + m.count, 0) };
    bigScope.dispose(); gl.render(scene, camera);
    for (let cycle = 0; cycle < 20; cycle++) { const s = new Disposables(), r = createTroopRenderer({ sim, scene, models, manifest, scope: s }); r.update(0, 0); gl.render(scene, camera); s.dispose(); gl.render(scene, camera); }
    const after = { ...gl.info.memory }, extension = gl.getContext().getExtension('WEBGL_debug_renderer_info'), renderer = extension ? gl.getContext().getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown';
    const stats = (values: number[]) => { const sorted = values.slice().sort((a, b) => a - b); return { samples: values.length, median: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) }; };
    for (const model of models.values()) new Disposables().object(model).dispose(); gl.dispose();
    return { count, cutCount, linesAfterCut, calls, triangles, colored, projected, fronts, headVisible, lowVisible, lowDraw, autoBig, baseline, after, renderer, jsMs: stats(samples), updateMs: stats(updates) };
  }, publicSimPath);
  console.log(`TROOPS_RESULT ${JSON.stringify(result)}`);
  expect(errors).toEqual([]); expect(result.count).toBe(2000); expect(result.cutCount).toBe(2000); expect(result.linesAfterCut).toBe(0);
  expect(result.calls).toBe(14); expect(result.calls).toBeLessThan(100); expect(result.jsMs.p95).toBeLessThan(4); expect(result.colored).toBeGreaterThan(100);
  expect(result.fronts.map((p: number[]) => p[0])).toEqual([20, 20, 20, 20]); expect(result.fronts.map((p: number[]) => p[1])).toEqual([0, 0, 20, 20]);
  expect(result.headVisible.every((n: number) => n > 0)).toBe(true); expect(result.lowVisible.every((n: number) => n > 0)).toBe(true); expect(result.lowDraw).toBe(true);
  expect(result.autoBig).toEqual({ lod: 'low', high: 0, low: 2000 }); expect(result.after).toEqual(result.baseline); expect(result.renderer).toContain('SwiftShader');
});
