// perf: 720 animated troops (600 soldiers + 120 tanks) on 40 lanes + 20 buildings under the SP08-style camera (FOV 21 / 55 deg), snow theme.
// View/troop buffer are synthetic (no sim): the renderer only reads view.{buildingStatic,buildings,players,units,lines} + TroopBuffer columns.
// Logs `perf: {...}` (renderer.info + wall-clock ms/frame; headless SwiftShader is software rendering, NOT representative of GPU fps).
import * as THREE from 'three';
import manifest from '../../../../apps/web/assets/manifest.json';
import levels from '../fixtures/levels.json';
import { createTroopBuffer } from '../../../../packages/sim/src/index.ts';
import { createWorldRenderer } from '../../../../apps/web/src/render/world.ts';
import { createMirroredWorldRoot } from '../../../../apps/web/src/render/world-root.ts';
import { fitCamera } from './env-scene.js';

const BASE = `${__WEB_ASSETS__}`;
const N_TROOPS = 720, COLS = 5, ROWS = 4;

export function createPerfFixture() {
  const base = structuredClone(levels['l21-snow']);
  const colors = ['blue', 'green', 'red', 'yellow'];
  const visuals = ['building.house-wt1', 'building.house-wt2', 'building.house-wt1', 'building.tower', 'building.house-wt1'];
  const tmpl = Object.fromEntries(base.buildings.map(b => [b.visual, b]));
  const buildings = [];
  for (let i = 0; i < COLS * ROWS; i++) {
    const v = visuals[i % visuals.length], t = tmpl[v];
    const c = i % COLS, r = Math.floor(i / COLS);
    buildings.push({ ...structuredClone(t), id: `b${i}`, x: Math.round(-8000 + c * 4000), z: Math.round(-5400 + r * 3600), owner: i % 4, level: 12 + ((i * 7) % 25) });
  }
  const level = { ...base, buildings, elements: [], players: colors.map((k, i) => ({ id: `p${i}`, kind: i ? 'ai' : 'human', colorKey: k })) };
  level.units = [{ ...base.units[0] }, { ...base.units[0], id: 'tank', visual: 'unit.tank', speed: 4000 }];
  const n = buildings.length;

  const col = f => Int32Array.from(buildings.map(f));
  const lines = [];
  const pairs = [];
  buildings.forEach((b, i) => { for (const d of [1, 5]) { const j = (i + d) % n; if (j === i || (d === 1 && j % COLS === 0)) continue; pairs.push([i, j]); } });
  for (const [from, to] of pairs) { const a = buildings[from], b = buildings[to]; lines.push({ channel: from * n + to, from, to, owner: a.owner, length: Math.round(Math.hypot(a.x - b.x, a.z - b.z)), drawSeq: 0 }); }
  const view = {
    tick: 0, over: null, timeLimitTicks: 0, bounds: level.bounds, ids: { buildings: [], players: [], elements: [] }, players: level.players,
    buildings: { owner: col(b => b.owner), level: col(b => b.level), maxLevel: col(() => 64), stage: col(b => (b.level >= 30 ? 3 : b.level >= 10 ? 2 : 1)), lines: col(() => 0), alive: col(() => 1), ignoreForWin: col(() => 0), col: {} },
    buildingStatic: buildings.map(b => ({ x: b.x, z: b.z, kind: b.kind, archetype: b.archetype, visual: b.visual, footprint: b.footprint, special: false, drawsLines: true, initialOwner: b.owner, modules: [] })),
    elements: [], lines, units: level.units, freeSlots: () => 0,
  };
  const buf = createTroopBuffer(1024);
  for (let i = 0; i < N_TROOPS; i++) {
    const l = lines[i % lines.length];
    buf.channel[i] = l.channel; buf.seq[i] = i; buf.owner[i] = l.owner; buf.kind[i] = i % 6 === 5 ? 1 : 0; buf.hp[i] = 1;
    buf.laneLength[i] = l.length; buf.speed[i] = level.units[buf.kind[i]].speed / 20; buf.progress[i] = Math.floor(((i * 37) % 97) / 97 * l.length * 0.9);
  }
  const frame = { view, troops: buf, n: N_TROOPS, alpha: 0.5 };
  return { level, frame };
}

export default async function perf({ canvas, width, height }) {
  const { level, frame } = createPerfFixture(), { view, troops: buf } = frame;
  const n = level.buildings.length, lines = view.lines;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(manifest.themes[level.theme].sky);
  const worldRoot = createMirroredWorldRoot(); scene.add(worldRoot);
  const world = createWorldRenderer(scene, manifest, { worldRoot, baseURL: BASE });
  await world.setLevel(level, level.theme);
  const camera = new THREE.PerspectiveCamera(21, width / height, 0.5, 400);
  fitCamera(camera, level.bounds, manifest.camera.margin);
  world.update(frame, [], 0);
  await new Promise(res => { let quiet = 0; const tick = () => { quiet = THREE.DefaultLoadingManager.isLoading ? 0 : quiet + 1; quiet > 20 ? res() : requestAnimationFrame(tick); }; tick(); });

  const gl = renderer.getContext(), px = new Uint8Array(4); // readPixels forces the (async) GL queue to finish so ms/frame is real
  const step = () => { for (let i = 0; i < N_TROOPS; i++) { buf.progress[i] = (buf.progress[i] + buf.speed[i]) % buf.laneLength[i]; } world.update(frame, [], 16.7); renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  for (let i = 0; i < 3; i++) step();
  const F = 15; const t0 = performance.now();
  for (let i = 0; i < F; i++) step();
  const ms = (performance.now() - t0) / F;
  const t1 = performance.now(); for (let i = 0; i < F; i++) world.update(frame, [], 16.7); const updMs = (performance.now() - t1) / F;
  renderer.render(scene, camera);
  const info = renderer.info.render;
  let unitDraws = 0; scene.traverse(o => { if (o.isInstancedMesh && o.visible && o.count > 0) unitDraws++; });
  console.log('perf: ' + JSON.stringify({ troops: N_TROOPS, buildings: n, lines: lines.length, drawCalls: info.calls, unitDrawCalls: unitDraws, triangles: info.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, msPerFrameSwiftShader: +ms.toFixed(1), msUpdateOnly: +updMs.toFixed(2) }));
  const el = document.createElement('div');
  el.textContent = `perf: ${N_TROOPS} troops + ${n} buildings, draws=${info.calls} (units ${unitDraws}) tris=${info.triangles}`;
  el.style.cssText = 'position:fixed;left:16px;top:12px;font:16px monospace;color:#000;background:#fffa;padding:2px 6px';
  document.body.append(el);
}
