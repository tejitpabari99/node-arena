// Shared by l4-green / l21-snow / obstacles-*: the end-to-end proof of createWorldRenderer (PRD R5). Real compiled level,
// real packages/sim run for a few seconds (scripted DrawLine from every owned building to its nearest enemy), real events,
// mirrored worldRoot owned here (SP08 will own it in the app), FOV 21 / 55 deg camera fitted to the level bounds.
import * as THREE from 'three';
import manifest from '../../../../apps/web/assets/manifest.json';
import levels from '../fixtures/levels.json';
import { create, createTroopBuffer } from '../../../../packages/sim/src/index.ts';
import { createWorldRenderer } from '../../../../apps/web/src/render/world.ts';
import { createMirroredWorldRoot } from '../../../../apps/web/src/render/world-root.ts';

const BASE = `${__WEB_ASSETS__}`;
const M = 0.001;
const TICK_MS = 50;

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

/** Scripted opening: each owned building draws one line to its nearest building of another owner (the sim rejects what it must). */
function openingCommands(sim, level) {
  const cmds = [];
  level.buildings.forEach((a, from) => {
    if (a.owner < 0) return;
    let best = -1, bd = Infinity;
    level.buildings.forEach((b, to) => { if (to === from || b.owner === a.owner) return; const d = Math.hypot(a.x - b.x, a.z - b.z); if (d < bd) { bd = d; best = to; } });
    if (best >= 0 && sim.canDraw(a.owner, from, best) === null) cmds.push({ type: 'DrawLine', player: a.owner, from, to: best });
  });
  return cmds;
}

export async function envScene({ canvas, width, height }, key, { label, preview = false, ticks = 260 } = {}) {
  const level = levels[key];
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(manifest.themes[level.theme].sky);
  const worldRoot = createMirroredWorldRoot(); scene.add(worldRoot);
  const world = createWorldRenderer(scene, manifest, { worldRoot, baseURL: BASE });
  await world.setLevel(level, level.theme);

  const sim = create(level, 11), buf = createTroopBuffer(4096);
  const cmds = openingCommands(sim, level);
  world.update({ view: sim.view, troops: buf, n: 0, alpha: 0, towerRadiusMilli: sim.towerRadiusMilli }, [], 0);
  let events = [], rows = 0;
  for (let t = 0; t < ticks; t++) {
    const ev = sim.step(t === 0 ? cmds : [], { events: true });
    rows = sim.readTroops(buf);
    world.update({ view: sim.view, troops: buf, n: rows, alpha: 0.5, towerRadiusMilli: sim.towerRadiusMilli }, ev, TICK_MS);
    events = ev;
  }
  if (preview) { // drag preview: from the human's first building toward a free point
    const h = level.buildings.find(b => b.owner === 0);
    world.previewLane({ x: h.x * M, z: h.z * M }, { x: h.x * M + 4.5, z: h.z * M + 3 }, level.players[0].colorKey);
  }

  const camera = new THREE.PerspectiveCamera(21, width / height, 0.5, 400);
  fitCamera(camera, level.bounds, manifest.camera.margin);
  await new Promise(res => { let quiet = 0; const tick = () => { quiet = THREE.DefaultLoadingManager.isLoading ? 0 : quiet + 1; quiet > 20 ? res() : requestAnimationFrame(tick); }; tick(); });
  world.update({ view: sim.view, troops: buf, n: rows, alpha: 0.5, towerRadiusMilli: sim.towerRadiusMilli }, [], 0);
  for (let i = 0; i < 3; i++) renderer.render(scene, camera), await new Promise(r => requestAnimationFrame(r));
  console.log(`${key}: buildings=${level.buildings.length} lines=${sim.view.lines.length} troops=${rows} picks=${world.pickMeshes.length} drawCalls=${renderer.info.render.calls} tris=${renderer.info.render.triangles}`);
  const el = document.createElement('div');
  el.textContent = label ?? key;
  el.style.cssText = 'position:fixed;left:16px;top:12px;font:16px monospace;color:#000;background:#fffa;padding:2px 6px';
  document.body.append(el);
}
