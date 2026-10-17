import path from 'node:path';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test('manifest-only fixture towers, real capture recolour, component labels, glyphs, projection and cache-safe disposal', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Renderer composition is wired into the shell in Task 12');
  const files = ['content.json', 'data/balance.json', 'data/levels/sample.json', 'data/troops/regular.json', 'data/archetypes/standard.json', 'data/archetypes/small.json', 'data/archetypes/large.json', 'data/examples/sample-bot.json'];
  const fileMap = Object.fromEntries(await Promise.all(files.map(async path => [path, await readFile(new URL(`../../../packages/content/${path}`, import.meta.url), 'utf8')])));
  const contentPath = `/@fs${fileURLToPath(new URL('../../../packages/content/src/index.ts', import.meta.url))}`;
  const simPath = `/@fs${fileURLToPath(new URL('../../../packages/sim/src/index.ts', import.meta.url))}`;
  await page.route('**/manifest.json',route=>route.fulfill({path:path.join(process.cwd(),'test/fixtures/greybox-manifest.json'),contentType:'application/json'})); // primitive models: these specs build renderers directly from manifest keys
  await page.goto('/');
  // Warm Vite's addon dependency optimizer before executing stateful verification.
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await page.evaluate(async () => { const path = '/src/manifest/assets.ts'; await import(path); }); break; }
    catch (error) { if (!(error instanceof Error) || !error.message.includes('Execution context was destroyed')) throw error; await page.waitForLoadState('networkidle'); }
  }
  const result = await page.evaluate(async ({ fileMap, contentPath, simPath }) => {
    const scenePath = '/src/render/scene.ts', assetsPath = '/src/manifest/assets.ts', scopePath = '/src/render/disposables.ts', towersPath = '/src/render/towers.ts', threePath = '/node_modules/.vite/deps/three.js';
    const { loadContent, compileLevel } = await import(contentPath), { create } = await import(simPath);
    const { createLevelScene } = await import(scenePath), { createTowerRenderer } = await import(towersPath);
    const { AssetManager } = await import(assetsPath), { Disposables } = await import(scopePath), { Box3, Mesh, MeshStandardMaterial } = await import(threePath);
    const fixture = JSON.parse(fileMap['data/archetypes/standard.json']); fixture.id = 'fixture-experimental'; fixture.visual = 'fixture.new-visual'; fixture.components.generates.ratePerSec = 10;
    fileMap['data/archetypes/fixture.json'] = JSON.stringify(fixture);
    const decoration = { ...fixture, id: 'fixture-decoration', visual: 'fixture.decorative', components: { garrison: { cap: 50 } } }; fileMap['data/archetypes/decoration.json'] = JSON.stringify(decoration);
    const ordinary = JSON.parse(fileMap['data/archetypes/standard.json']); ordinary.components.generates.ratePerSec = .001; fileMap['data/archetypes/standard.json'] = JSON.stringify(ordinary);
    const authored = JSON.parse(fileMap['data/levels/sample.json']);
    authored.towers[0].archetype = fixture.id; authored.towers[0].garrison = 50; authored.towers[0].pos.x = -4;
    authored.towers[1].garrison = 0; authored.towers[1].pos.x = 4;
    authored.towers[2].archetype = decoration.id; authored.towers[2].garrison = 0; authored.towers[2].pos.y = 6;
    fileMap['data/levels/sample.json'] = JSON.stringify(authored);
    const level = compileLevel(loadContent(fileMap), authored.id), sim = create(level, 17);
    const manifest = await (await fetch('/manifest.json')).json();
    manifest.visuals[fixture.visual] = { kind: 'tower', model: 'block', scale: 2, yOffset: 3, tint: '#123456', teamMaterial: 'Accent', label: { height: 17 } };
    manifest.visuals[decoration.visual] = { kind: 'tower', model: 'block', scale: .5 };
    const manager = new AssetManager(manifest), session = manager.createSession(manager.resolveLevelAssets(level)); await session.load();
    const cached = session.models.get('block'); let cachedMesh: any; cached.traverse((node: any) => { if (node instanceof Mesh) cachedMesh = node; });
    const originalColor = cachedMesh.material.color.getHexString(); let sharedDisposals = 0;
    cachedMesh.geometry.addEventListener('dispose', () => sharedDisposals++); cachedMesh.material.addEventListener('dispose', () => sharedDisposals++);
    const parent = document.createElement('div'); parent.style.cssText = 'width:800px;height:600px'; document.body.appendChild(parent);
    const scope = new Disposables(), world = createLevelScene({ level, manifest, models: session.models, parent, scope, quality: 'low' });
    const presentationView = { ...sim.view, towerStatic: sim.view.towerStatic.map((tower: any, index: number) => index === 2 ? { ...tower, components: ['future-no-overlay'] } : tower) };
    const towers = createTowerRenderer({ view: presentationView, manifest, models: session.models, scene: world.scene, camera: world.camera, parent, scope });
    world.render(); const first = towers.towers[0], target = towers.towers[1], decorative = towers.towers[2];
    const box = new Box3().setFromObject(first.model), label = first.label.element;
    const markerPixels = first.roofMarker.material.map.image.getContext('2d').getImageData(0, 0, 128, 128).data;
    let whiteMarkerPixels = 0; for (let i = 0; i < markerPixels.length; i += 4) if (markerPixels[i] > 240 && markerPixels[i + 1] > 240 && markerPixels[i + 2] > 240) whiteMarkerPixels++;
    const initial = { whiteMarkerPixels, draws: world.renderer.info.render.calls, neutralBase: decorative.base.material.color.getHexString(), neutralGlyph: decorative.roofMarker.userData.glyph, position: first.group.position.toArray(), scale: first.model.scale.x, modelY: first.model.position.y, modelHeight: box.max.y - box.min.y,
      labelHeight: first.label.position.y, tint: first.model.children[0].material.color.getHexString(), base: first.base.material.color.getHexString(), labelCount: parent.querySelectorAll('[data-tower-index]').length,
      decorativeLabel: Boolean(decorative.label), glyphs: [first.baseMarker.userData.glyph, first.roofMarker.userData.glyph, label.querySelector('[data-team-marker]').textContent],
      font: getComputedStyle(label).fontSize, foreground: getComputedStyle(label).color, background: getComputedStyle(label).backgroundColor };
    const observer = new MutationObserver(() => {}); observer.observe(parent.querySelector('[data-tower-labels]')!, { attributes: true, childList: true, characterData: true, subtree: true });
    towers.update(sim.view); towers.resize(); const unchangedMutations = observer.takeRecords().length;
    const startTargetColor = target.base.material.color.getHexString(), startTargetGlyph = target.roofMarker.userData.glyph;
    const events = sim.step([{ type: 'DrawLine', player: 'p1', from: 't1', to: 't2' }]); towers.update(sim.view);
    const lineText = label.querySelector('[data-component="drawsLines"]').textContent;
    let captured = events.some((event: any) => event.type === 'Captured');
    for (let i = 0; i < 2000 && !captured; i++) captured = sim.step([]).some((event: any) => event.type === 'Captured');
    const transforms = [...parent.querySelectorAll('[data-tower-index]')].map((e: any) => e.style.transform); towers.update(sim.view);
    const valueUpdateMoves = [...parent.querySelectorAll('[data-tower-index]')].some((e: any, i) => e.style.transform !== transforms[i]);
    const capture = { captured, startTargetColor, startTargetGlyph, color: target.base.material.color.getHexString(), glyph: target.roofMarker.userData.glyph,
      labelGlyph: target.label.element.querySelector('[data-team-marker]').textContent, count: target.label.element.querySelector('[data-component="garrison"]').textContent, expectedCount: String(sim.view.tower.col['garrison.count'][1]) };
    towers.update(sim.view, { colorblind: true });
    const colorblind = first.base.material.color.getHexString();
    // Camera edits are explicitly projected; all chip edges stay clamped even offscreen.
    world.camera.position.x += 100; world.camera.updateMatrixWorld(); towers.projectLabels();
    const clamped: boolean[] = [];
    for (const [w, h] of [[180, 900], [1200, 200], [60, 40]]) {
      parent.style.width = `${w}px`; parent.style.height = `${h}px`; world.resize(); towers.resize(); world.render(); const p = parent.getBoundingClientRect();
      for (const element of parent.querySelectorAll('[data-tower-index]')) { const b = element.getBoundingClientRect(); clamped.push(b.left >= p.left - 1 && b.right <= p.right + 1 && b.top >= p.top - 1 && b.bottom <= p.bottom + 1); }
    }
    observer.disconnect();
    towers.dispose(); towers.dispose(); world.render(); const afterOwnDispose = { labelLayerGone: !parent.querySelector('[data-tower-labels]'), groupsGone: towers.towers.every((tower: any) => !tower.group.parent), sharedDisposals };
    const cacheUnchanged = originalColor === cachedMesh.material.color.getHexString();
    const baseline = { ...world.renderer.info.memory };
    const memoryStable: boolean[] = [];
    for (let switchIndex = 0; switchIndex < 20; switchIndex++) {
      const switched = createTowerRenderer({ view: presentationView, manifest, models: session.models, scene: world.scene, camera: world.camera, parent, scope });
      world.render(); switched.dispose(); world.render();
      memoryStable.push(world.renderer.info.memory.geometries === baseline.geometries && world.renderer.info.memory.textures === baseline.textures);
    }
    // Exercise actual named-material split; every clone owns its own recolourable material.
    const accent = new MeshStandardMaterial({ name: 'Accent', color: '#abcdef' }), replacement = cached.clone(true);
    replacement.children[0].material = accent;
    const named = createTowerRenderer({ view: sim.view, manifest, models: new Map([['block', replacement]]), scene: world.scene, camera: world.camera, parent, scope });
    const teamMaterialColor = named.towers[0].model.children[0].material.color.getHexString(); named.dispose(); accent.dispose();
    world.dispose(); const emptyParent = parent.children.length === 0; session.dispose(); manager.dispose(); parent.remove();
    return { initial, unchangedMutations, lineText, valueUpdateMoves, capture, colorblind, clamped, afterOwnDispose, cacheUnchanged, memoryStable, teamMaterialColor, emptyParent };
  }, { fileMap, contentPath, simPath });
  expect(result.initial).toMatchObject({ position: [-4, 0, 0], scale: 2, modelY: 3, modelHeight: 12, labelHeight: 17, tint: '123456', base: '2e86ff', labelCount: 2, decorativeLabel: false,
    neutralBase: 'a0a7b0', neutralGlyph: '○', glyphs: ['▲', '▲', '▲'], font: '14px', foreground: 'rgb(255, 255, 255)', background: 'rgb(17, 24, 39)' });
  expect(result.initial.whiteMarkerPixels).toBeGreaterThan(100); expect(result.initial.draws).toBeGreaterThan(0); expect(result.memoryStable.every(Boolean)).toBe(true);
  expect(result.unchangedMutations).toBe(0); expect(result.lineText).toContain('●'); expect(result.valueUpdateMoves).toBe(false);
  expect(result.capture).toMatchObject({ captured: true, startTargetColor: 'ff4d4d', startTargetGlyph: '■', color: '2e86ff', glyph: '▲', labelGlyph: '▲' });
  expect(result.capture.count).toBe(result.capture.expectedCount); expect(result.colorblind).toBe('0072b2'); expect(result.clamped.every(Boolean)).toBe(true);
  expect(result.afterOwnDispose).toEqual({ labelLayerGone: true, groupsGone: true, sharedDisposals: 0 }); expect(result.cacheUnchanged && result.emptyParent).toBe(true);
  expect(result.teamMaterialColor).toBe('2e86ff');
});
