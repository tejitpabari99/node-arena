// unit-lineup: soldier (5 run phases) + tank (3) per team, plus Death ghosts at 4 ages. Uses the real unit renderer + shipped GLB/PNG assets.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import manifest from '../../../../apps/web/assets/manifest.json';
import { MaterialCache } from '../../../../apps/web/src/render/materials.ts';
import { ModelCache } from '../../../../apps/web/src/render/gltf-cache.ts';
import { buildLightRig } from '../../../../apps/web/src/render/light-rig.ts';
import { createUnitRenderer } from '../../../../apps/web/src/render/unit-renderer.ts';

const BASE = `${__WEB_ASSETS__}`;
const TEAMS = ['blue', 'green', 'red', 'yellow'];

export default async function unitLineup({ canvas, width, height }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9ec6e8);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshLambertMaterial({ color: 0x6f9f47 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const rig = buildLightRig(manifest.themes.green.light);
  scene.add(rig.group);

  const manager = new THREE.LoadingManager(), tl = new THREE.TextureLoader(manager);
  const loaded = new Promise(res => { manager.onLoad = res; });
  const materials = new MaterialCache(p => tl.load(`${BASE}/${p}`));
  const gl = new GLTFLoader(); gl.setMeshoptDecoder(MeshoptDecoder);
  const models = new ModelCache(f => gl.loadAsync(`${BASE}/${f}`));
  const mk = id => createUnitRenderer({ visualId: id, visual: manifest.visuals[id], materials, models });
  const [soldier, tank] = await Promise.all([mk('unit.soldier'), mk('unit.tank')]);
  await loaded;
  for (const r of [soldier, tank]) { r.setCapacity(1, 64); scene.add(r.root); }

  // Each unit gets its own 1 m lane (two dummy buildings); progress 0 = at lane start. Lanes alternate +x (profile) and +z (facing camera).
  const bs = [], units = [], rowZ = t => -2.4 + t * 1.6;
  const add = (kind, owner, xm, zm, dir, seq) => {
    const a = bs.push({ x: xm * 1000, z: zm * 1000 }) - 1;
    bs.push({ x: xm * 1000 + (dir === 'x' ? 1000 : 0), z: zm * 1000 + (dir === 'z' ? 1000 : 0) });
    units.push({ kind, owner, from: a, to: a + 1, seq });
  };
  TEAMS.forEach((_, t) => {
    for (let i = 0; i < 5; i++) add(0, t, -7 + i * 1.0, rowZ(t), i < 3 ? 'x' : 'z', 100 * t + i + 1);
    for (let i = 0; i < 3; i++) add(1, t, -1.0 + i * 1.3, rowZ(t), i < 2 ? 'x' : 'z', 100 * t + 50 + i);
  });
  const n = bs.length, N = units.length;
  const buf = { channel: new Int32Array(N), seq: new Int32Array(N), owner: new Int32Array(N), kind: new Int32Array(N), progress: new Int32Array(N), hp: new Int32Array(N), speed: new Int32Array(N), laneLength: new Int32Array(N) };
  units.forEach((u, i) => { buf.channel[i] = u.from * n + u.to; buf.seq[i] = u.seq; buf.owner[i] = u.owner; buf.kind[i] = u.kind; buf.laneLength[i] = 20000; });
  const view = { buildingStatic: bs, units: [{ id: 'soldier', visual: 'unit.soldier' }, { id: 'tank', visual: 'unit.tank' }], players: TEAMS.map(colorKey => ({ kind: 'ai', colorKey })) };
  const frame = { view, troops: buf, n: N, alpha: 0 };

  // Death ghosts: staggered spawns so final ages are 0.1 / 0.4 / 0.7 / 1.0 s (soldier row) at x = 3..6; tank procedural at x = 8.
  const ages = [1.0, 0.7, 0.4, 0.1], dt = 0.1, steps = 11;
  for (let s = 0; s <= steps; s++) {
    const events = [];
    TEAMS.forEach((_, t) => ages.forEach((age, k) => { if (Math.round((1.1 - age) / dt) === s) events.push({ type: 'TroopDied', channel: 1, seq: 7 * k + t, owner: t, kind: 'soldier', cause: 'clash', x: (3 + k * 1.0) * 1000, z: rowZ(t) * 1000 }); }));
    TEAMS.forEach((_, t) => { if (s === 5) events.push({ type: 'TroopDied', channel: 1, seq: 900 + t, owner: t, kind: 'tank', cause: 'clash', x: 8.5 * 1000, z: rowZ(t) * 1000 }); });
    soldier.update(frame, events, dt * 1000); tank.update(frame, events, dt * 1000);
  }
  console.log(`unit-lineup draw calls soldier=${soldier.drawCalls} tank=${tank.drawCalls}`);

  const camera = new THREE.PerspectiveCamera(21, width / height, 0.1, 200);
  const pitch = THREE.MathUtils.degToRad(55), dist = 27;
  camera.position.set(0.5, Math.sin(pitch) * dist, Math.cos(pitch) * dist + 0);
  camera.lookAt(0.5, 0, 0);
  renderer.render(scene, camera);
  const label = document.createElement('div');
  label.textContent = 'unit-lineup: soldier x5 (3 profile, 2 front) | ghosts age 1.0/0.7/0.4/0.1 s | tank x3 + tank ghost; rows blue/green/red/yellow';
  label.style.cssText = 'position:fixed;left:16px;top:12px;font:16px monospace;color:#fff;text-shadow:0 1px 2px #000';
  document.body.append(label);
}
