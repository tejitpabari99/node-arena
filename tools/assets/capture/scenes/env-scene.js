// Shared by the env scenes (ground + obstacles + lanes for real compiled level data; buildings are simple placeholders until Task 7).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import manifest from '../../../../apps/web/assets/manifest.json';
import levels from '../fixtures/levels.json';
import { MaterialCache } from '../../../../apps/web/src/render/materials.ts';
import { ModelCache } from '../../../../apps/web/src/render/gltf-cache.ts';
import { createEnvironment } from '../../../../apps/web/src/render/environment.ts';
import { createMirroredWorldRoot } from '../../validate/world-root.js';

const BASE = `${__WEB_ASSETS__}`;
const M = 0.001;

/** Camera per PRD R5: FOV 21 / 55 deg pitch, fitted so level bounds + margin are inside the frame. Data frame -> world z is mirrored. */
export function fitCamera(camera, bounds, margin, pitchDeg = 55) {
  const [x0, x1, z0, z1] = [bounds.minX * M - margin, bounds.maxX * M + margin, -(bounds.maxZ * M) - margin, -(bounds.minZ * M) + margin];
  const center = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2), pitch = THREE.MathUtils.degToRad(pitchDeg);
  const back = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch)), up = new THREE.Vector3(0, Math.cos(pitch), -Math.sin(pitch));
  const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  let dist = 0.1;
  for (const x of [x0, x1]) for (const z of [z0, z1]) {
    const p = new THREE.Vector3(x, 0, z).sub(center), depth = p.dot(back);
    dist = Math.max(dist, depth + Math.abs(p.x) / (tanY * camera.aspect), depth + Math.abs(p.dot(up)) / tanY);
  }
  camera.position.copy(center).addScaledVector(back, dist); camera.up.copy(up); camera.lookAt(center); camera.updateProjectionMatrix();
}

export async function envScene({ canvas, width, height }, key, { label, preview = false } = {}) {
  const level = levels[key], theme = manifest.themes[level.theme];
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(theme.sky);

  const tl = new THREE.TextureLoader(), pending = [];
  const materials = new MaterialCache(p => { let done; pending.push(new Promise((res, rej) => { done = [res, rej]; })); return tl.load(`${BASE}/${p}`, done[0], undefined, done[1]); });
  const gl = new GLTFLoader(); gl.setMeshoptDecoder(MeshoptDecoder);
  const models = new ModelCache(f => gl.loadAsync(`${BASE}/${f}`));
  const env = createEnvironment(manifest, materials, models);
  await env.setLevel({ bounds: level.bounds, elements: level.elements }, level.theme);
  await Promise.all(pending);
  const worldRoot = createMirroredWorldRoot(); worldRoot.add(env.root); scene.add(worldRoot);

  // Placeholder buildings (Task 7 replaces): coloured disc + block by owner.
  const colors = level.players.map(p => manifest.palettes[p.colorKey]);
  const bs = level.buildings.map(b => ({ x: b.x, z: b.z, kind: b.kind, owner: b.owner }));
  for (const b of bs) {
    const c = b.owner >= 0 ? colors[b.owner] : manifest.palettes.gray;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 1.2, 16), new THREE.MeshLambertMaterial({ color: c }));
    m.position.set(b.x * M, 0.6, b.z * M); worldRoot.add(m);
  }
  // Lanes: each owned building draws one lane to its nearest building of another owner (scripted; real lines come from the sim view).
  const lines = [];
  bs.forEach((a, from) => {
    if (a.owner < 0) return;
    let best = -1, bd = Infinity;
    bs.forEach((b, to) => { if (to === from || b.owner === a.owner) return; const d = Math.hypot(a.x - b.x, a.z - b.z); if (d < bd) { bd = d; best = to; } });
    if (best >= 0) lines.push({ channel: from * bs.length + best, from, to: best, owner: a.owner, length: bd, drawSeq: lines.length });
  });
  const view = { lines, buildingStatic: bs, players: level.players };
  env.update(view, 0); env.update(view, 350); // a non-zero scroll phase
  if (preview) { // drag preview: from the human's first building toward a free point
    const h = bs.find(b => b.owner === 0);
    env.lanes.previewLane({ x: h.x * M, z: h.z * M }, { x: h.x * M + 4.5, z: h.z * M + 3 }, level.players[0].colorKey);
  }

  const camera = new THREE.PerspectiveCamera(21, width / height, 0.5, 400);
  fitCamera(camera, level.bounds, manifest.camera.margin);
  renderer.render(scene, camera);
  console.log(`${key}: obstacles small=${env.elements.counts.small} big=${env.elements.counts.big} draws=${env.elements.drawCalls} lanes=${env.lanes.stats.active} (pool ${env.lanes.stats.created}) ground half=${env.ground.plan.halfX.toFixed(1)}x${env.ground.plan.halfZ.toFixed(1)}`);
  const el = document.createElement('div');
  el.textContent = label ?? key;
  el.style.cssText = 'position:fixed;left:16px;top:12px;font:16px monospace;color:#000;background:#fffa;padding:2px 6px';
  document.body.append(el);
}
