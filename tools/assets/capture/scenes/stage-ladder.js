// stage-ladder: the real building renderer (Task 7) — 3 kinds x 3 stages x 5 teams (4 colours + neutral gray) under the
// FOV 21 / 55 deg pitch camera, inside a z-mirrored worldRoot (labels outside it, as SP08 will do).
import * as THREE from 'three';
import manifest from '../../../../apps/web/assets/manifest.json';
import balance from '../../../../packages/content/data/balance.json';
import manifestUrl from '../../../../apps/web/assets/manifest.json?url';
import { MaterialCache, createBrowserTextureLoader } from '../../../../apps/web/src/render/materials.ts';
import { ModelCache, createBrowserGltfLoader } from '../../../../apps/web/src/render/gltf-cache.ts';
import { buildLightRig } from '../../../../apps/web/src/render/light-rig.ts';
import { createBuildingFactory } from '../../../../apps/web/src/render/building.ts';
import { createCanvasLabelPainter, loadLabelFont } from '../../../../apps/web/src/render/building-label.ts';

const KINDS = ['building.house-wt1', 'building.house-wt2', 'building.tower'];
const TEAMS = ['blue', 'green', 'red', 'yellow', null]; // null = neutral gray
const GAP = 2.3;

export default async function stageLadder({ canvas, width, height }) {
  const base = manifestUrl.slice(0, manifestUrl.lastIndexOf('/'));
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x7aa860);
  const theme = Object.values(manifest.themes)[0];
  scene.add(buildLightRig(theme.light).group);

  const materials = new MaterialCache(await createBrowserTextureLoader(base));
  const models = new ModelCache(await createBrowserGltfLoader(base));
  const painter = createCanvasLabelPainter();
  await loadLabelFont(base);
  const thresholds = balance.stageThresholds;
  const levels = [Math.max(1, thresholds[0] - 5), thresholds[0], thresholds[1]];
  const players = TEAMS.filter(Boolean).map(colorKey => ({ kind: 'ai', colorKey }));
  const cols = { owner: [], level: [], stage: [] };
  const worldRoot = new THREE.Group(); worldRoot.scale.z = -1; scene.add(worldRoot);
  const labels = new THREE.Group(); scene.add(labels);
  const projectile = { visualId: 'fx.projectile', visual: manifest.visuals['fx.projectile'] };
  const renderers = [];
  let next = 0;
  const span = 3 * GAP; // one kind panel width
  for (let k = 0; k < KINDS.length; k++) {
    const visualId = KINDS[k];
    const r = await createBuildingFactory({ painter, projectile })({ visualId, visual: manifest.visuals[visualId], materials, models });
    const inits = [];
    for (let t = 0; t < TEAMS.length; t++) for (let s = 0; s < 3; s++) {
      const index = next++;
      cols.owner[index] = TEAMS[t] ? TEAMS[t] === 'blue' ? 0 : TEAMS[t] === 'green' ? 1 : TEAMS[t] === 'red' ? 2 : 3 : -1;
      cols.level[index] = levels[s]; cols.stage[index] = 1 + thresholds.filter(x => x <= levels[s]).length;
      inits.push({ index, id: `${visualId}/${t}/${s}`, x: Math.round(((k - 1) * (span + 1.2) + (s - 1) * GAP) * 1000), z: Math.round((t - 2) * 3.1 * 1000), radius: 800 });
    }
    r.setBuildings(inits); r.bindWorldRoot(worldRoot);
    worldRoot.add(r.root); labels.add(r.labelRoot); renderers.push(r);
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 40).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x8cbf6e }));
  ground.position.y = -0.01; worldRoot.add(ground);

  const view = { players, buildings: cols };
  const sim = { towerRadiusMilli: () => 2600 };
  for (const r of renderers) r.update({ view }, [], 16, sim);

  const camera = new THREE.PerspectiveCamera(21, width / height, 0.1, 300);
  const dist = 56; const pitch = (55 * Math.PI) / 180;
  camera.position.set(0, Math.sin(pitch) * dist, -Math.cos(pitch) * dist * -1);
  camera.lookAt(0, 0.6, 0);
  // wait for textures + font, then draw
  await new Promise(res => { let quiet = 0; const tick = () => { quiet = THREE.DefaultLoadingManager.isLoading ? 0 : quiet + 1; quiet > 20 ? res() : requestAnimationFrame(tick); }; tick(); });
  for (let i = 0; i < 3; i++) { renderer.render(scene, camera); await new Promise(r => requestAnimationFrame(r)); }
}
