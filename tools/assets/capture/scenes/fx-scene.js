// fx: the real building renderer (tower + 2 houses) plus the Task 10 FX pool, frozen mid-lifetime under the FOV 21 / 55 deg camera
// (in a z-mirrored worldRoot). Shows: capture ring+star (blue house), stage-up ring (green house), tower shot beam, death burst, clash.
import * as THREE from 'three';
import manifest from '../../../../apps/web/assets/manifest.json';
import balance from '../../../../packages/content/data/balance.json';
import manifestUrl from '../../../../apps/web/assets/manifest.json?url';
import { MaterialCache, createBrowserTextureLoader } from '../../../../apps/web/src/render/materials.ts';
import { ModelCache, createBrowserGltfLoader } from '../../../../apps/web/src/render/gltf-cache.ts';
import { buildLightRig } from '../../../../apps/web/src/render/light-rig.ts';
import { createBuildingFactory } from '../../../../apps/web/src/render/building.ts';
import { createCanvasLabelPainter, loadLabelFont } from '../../../../apps/web/src/render/building-label.ts';
import { createFxFactory } from '../../../../apps/web/src/render/fx-pool.ts';

export default async function fxScene({ canvas, width, height }) {
  const base = manifestUrl.slice(0, manifestUrl.lastIndexOf('/'));
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8cbf6e);
  scene.add(buildLightRig(Object.values(manifest.themes)[0].light).group);
  const materials = new MaterialCache(await createBrowserTextureLoader(base));
  const models = new ModelCache(await createBrowserGltfLoader(base));
  const painter = createCanvasLabelPainter(); await loadLabelFont(base);
  const worldRoot = new THREE.Group(); worldRoot.scale.z = -1; scene.add(worldRoot);
  const labels = new THREE.Group(); scene.add(labels);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 24).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x8cbf6e }));
  ground.position.y = -0.01; worldRoot.add(ground);

  const projectile = { visualId: 'fx.projectile', visual: manifest.visuals['fx.projectile'] };
  const th = balance.stageThresholds;
  // index: 0 tower (green), 1 house (green, stage-up), 2 house (blue, just captured from neutral)
  const spec = [
    { id: 'building.tower', x: 4000, z: -1500, owner: 0, level: 6 },
    { id: 'building.house-wt1', x: -4500, z: 1500, owner: 0, level: th[0] - 1 },
    { id: 'building.house-wt1', x: 5000, z: 3500, owner: 1, level: 5 },
  ];
  const players = [{ kind: 'ai', colorKey: 'green' }, { kind: 'ai', colorKey: 'blue' }];
  const cols = { owner: spec.map(s => s.owner), level: spec.map(s => s.level), stage: spec.map(() => 1) };
  const view = { players, buildings: cols };
  const sim = { towerRadiusMilli: () => 3600 };
  for (let i = 0; i < spec.length; i++) {
    const s = spec[i];
    const r = await createBuildingFactory({ painter, projectile })({ visualId: s.id, visual: manifest.visuals[s.id], materials, models });
    r.setBuildings([{ index: i, id: `b${i}`, x: s.x, z: s.z, radius: 800 }]); r.bindWorldRoot(worldRoot);
    worldRoot.add(r.root); labels.add(r.labelRoot);
    r.update({ view }, [], 16, sim); if (i === 0) r.setShowTowerRanges(true);
  }
  const fx = createFxFactory({ manifest })({ visualId: 'fx', visual: manifest.visuals['fx.projectile'], materials, models });
  fx.setBuildings(spec.map((s, i) => ({ index: i, x: s.x, z: s.z })));
  worldRoot.add(fx.root);
  fx.update({ view }, [], 0); // record stages
  cols.stage[1] = 2; cols.level[1] = th[0];
  const ev = [
    { type: 'BuildingCaptured', building: 2, from: -1, to: 1 },
    { type: 'TroopDied', channel: 0, seq: 0, owner: 1, kind: 'soldier', cause: 'tower', x: 1200, z: -200 },
    { type: 'Clash', kind: 'headon', a: { channel: 1, seq: 0, owner: 0 }, b: { channel: 2, seq: 0, owner: 1 }, x: -1200, z: 3000 },
  ];
  fx.update({ view }, ev, 0);   // capture ring+star (blue house), stage-up ring (green house), death burst, clash
  fx.update({ view }, [], 260); // rings/sparks mid-flight (rings 600 ms, sparks 350 ms)
  fx.update({ view }, [{ type: 'TowerShot', tower: 0, target: { kind: 'troop', channel: 0, seq: 0 }, x: 1200, z: -200 }], 0);
  fx.update({ view }, [], 60);  // beam (150 ms) mid-flight
  console.log(`fx: active=${fx.activeCount} ${JSON.stringify(fx.stats)}`);

  const camera = new THREE.PerspectiveCamera(21, width / height, 0.1, 300);
  const dist = 34, pitch = (55 * Math.PI) / 180;
  camera.position.set(0.5, Math.sin(pitch) * dist, Math.cos(pitch) * dist + 1.2);
  camera.lookAt(0.5, 0, 1.2);
  await new Promise(res => { let quiet = 0; const tick = () => { quiet = THREE.DefaultLoadingManager.isLoading ? 0 : quiet + 1; quiet > 20 ? res() : requestAnimationFrame(tick); }; tick(); });
  for (let i = 0; i < 3; i++) renderer.render(scene, camera), await new Promise(r => requestAnimationFrame(r));
}
