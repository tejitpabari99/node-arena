import { Box3, CanvasTexture, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3, type Camera, type Scene, type Texture } from 'three';
import { TICK_RATE, type SimEvent, type SimView } from '@node-arena/sim';
import type { Manifest } from '@node-arena/content';
import { createManifestResolver } from '../manifest/resolve.js';
import { Disposables } from './disposables.js';
import { buildLowTroopGeometry } from './troop-lod.js';
import type { Lane, TroopFronts } from './lines.js';

/** Brawl FX at the shared-lane split (SP04 Req 7). Cosmetic: 2-6 team-tinted fighters, billboard puffs, a crossed-swords marker.
 * Three instanced meshes, all preallocated; every offset/lifetime is a pure function of (pair hash, sim tick), never `Math.random` or a clock. */
export const BRAWLS = 6, PUFFS_PER_BRAWL = 12, AMBIENT_PUFFS = 6, BURST_PUFFS = PUFFS_PER_BRAWL - AMBIENT_PUFFS, MAX_FIGHTERS = 6;
export const RECENT_CLASH_S = 1.2, EMA_TAU_S = 2, FADE_S = .25, PUFF_LIFE_S = .7, MARKER_LIFT = 1;
export const PUFF_RATE_MIN = 2, PUFF_RATE_MAX = 10, MARKER_SCALE_MIN = .8, MARKER_SCALE_MAX = 1.2, CREAM = '#fff4d6';
const LANE_Y = .04, TAU = Math.PI * 2;

/** Intensity 0..1 from the clash-rate EMA (events/s divided by 1). */
export const intensityOf = (ema: number) => Math.min(1, Math.max(0, ema));
/** One EMA step: `events` clashes happened over `dt` seconds. Pure; tau 2 s. */
export function stepClashEma(ema: number, events: number, dt: number): number { return dt > 0 ? ema + (events / dt - ema) * (1 - Math.exp(-dt / EMA_TAU_S)) : ema; }
export const fighterCount = (intensity: number) => 2 + Math.round(4 * Math.min(1, Math.max(0, intensity)));
export const puffRate = (intensity: number) => PUFF_RATE_MIN + (PUFF_RATE_MAX - PUFF_RATE_MIN) * Math.min(1, Math.max(0, intensity));
export const markerScale = (intensity: number) => MARKER_SCALE_MIN + (MARKER_SCALE_MAX - MARKER_SCALE_MIN) * Math.min(1, Math.max(0, intensity));
/** Integer hash -> float in [0, 1); closure-free so seeding never allocates. */
export function hash01(seed: number, k: number): number {
  let x = (seed ^ Math.imul((k | 0) + 1, 0x9e3779b1)) | 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
export function pairHash(pair: string): number { let h = 0x811c9dc5; for (let i = 0; i < pair.length; i++) h = Math.imul(h ^ pair.charCodeAt(i), 0x01000193); return h | 0; }
/** (pair, tick) seed. */
export const brawlSeed = (pairH: number, tick: number) => (pairH ^ Math.imul(tick | 0, 0x9e3779b1)) | 0;

/** Soft cumulus blob: fixed overlapping radial lobes (white, alpha falloff). */
export function drawCloud(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.clearRect(0, 0, size, size);
  const lobes: readonly (readonly [number, number, number, number])[] = [[.5, .52, .34, 1], [.36, .58, .24, .85], [.64, .58, .25, .85], [.44, .4, .22, .8], [.6, .4, .2, .75]];
  for (const [x, y, r, a] of lobes) {
    const g = ctx.createRadialGradient(x * size, y * size, 0, x * size, y * size, r * size);
    g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(.55, `rgba(255,255,255,${a * .55})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  }
}
/** Crossed swords: dark outline, cream blades, hilts. */
export function drawSwords(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.clearRect(0, 0, size, size); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const c = size / 2, r = size * .36;
  for (const [outline, width, color] of [[true, size * .16, '#2a2118'], [false, size * .09, CREAM]] as const) for (const dir of [-1, 1]) {
    ctx.save(); ctx.translate(c, c); ctx.rotate(dir * Math.PI / 4); ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, r * .55); ctx.stroke();
    ctx.lineWidth = width * (outline ? 1.2 : .8); ctx.beginPath(); ctx.moveTo(-r * .38, r * .5); ctx.lineTo(r * .38, r * .5); ctx.stroke(); ctx.restore();
  }
}

interface Brawl {
  pair: string; pairH: number; active: boolean; vis: number; seed: number; x: number; z: number; dx: number; dz: number; lo: number; hi: number; laneWidth: number;
  ema: number; pending: number; clashAt: number; cursor: number; burstBorn: Float64Array; burstSeed: Int32Array; burstX: Float64Array; burstZ: Float64Array; fighters: number; ambient: number; seen: boolean;
}
export interface BrawlRendererOptions {
  view: SimView; manifest: Manifest; scene: Scene; scope: Disposables;
  /** Live lane map (the line renderer). */
  lines: { readonly lanes: ReadonlyMap<number, Lane> };
  /** Fighter height in world units (troop `heightWorld`); default 5. */
  figureHeight?: number | undefined; palette?: keyof Manifest['palettes']; reducedMotion?: boolean;
  /** Canvas factory for the generated textures; omitted -> document canvas, or no texture when there is no DOM. */
  createCanvas?: () => HTMLCanvasElement;
}
function makeTexture(factory: (() => HTMLCanvasElement) | undefined, size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): Texture | null {
  const canvas = factory ? factory() : typeof document !== 'undefined' ? document.createElement('canvas') : null; if (!canvas) return null;
  canvas.width = canvas.height = size; const ctx = canvas.getContext('2d'); if (!ctx) return null; draw(ctx, size);
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; return texture;
}

export function createBrawlRenderer(options: BrawlRendererOptions) {
  const scope = new Disposables(), resolver = createManifestResolver(options.manifest), scene = options.scene;
  let view = options.view, palette = options.palette ?? 'default', reduced = options.reducedMotion ?? false, height = options.figureHeight ?? 5, lastSeconds: number | undefined, disposed = false;
  const owners = Math.max(1, view.players.length), teamColors: Color[] = [];
  function paint() { for (let i = 0; i < owners; i++) (teamColors[i] ??= new Color()).set(resolver.color(view.players[i]?.colorKey ?? 'neutral', palette)); }
  paint();
  const slots: Brawl[] = [];
  for (let i = 0; i < BRAWLS; i++) slots.push({ pair: '', pairH: 0, active: false, vis: 0, seed: 0, x: 0, z: 0, dx: 1, dz: 0, lo: -1, hi: -1, laneWidth: 4, ema: 0, pending: 0, clashAt: -Infinity, cursor: 0,
    burstBorn: new Float64Array(BURST_PUFFS).fill(-Infinity), burstSeed: new Int32Array(BURST_PUFFS), burstX: new Float64Array(BURST_PUFFS), burstZ: new Float64Array(BURST_PUFFS), fighters: 0, ambient: 0, seen: false });

  // Fighters: low troop figure (unit height), one instanced mesh, instanceColor = team tint.
  const fighterGeometry = scope.add(buildLowTroopGeometry(new Box3(new Vector3(-.5, 0, -.5), new Vector3(.5, 1, .5))));
  const fighterMaterial = scope.add(new MeshStandardMaterial({ roughness: .9, metalness: 0, emissive: new Color('#262626') }));
  const fighters = new InstancedMesh(fighterGeometry, fighterMaterial, BRAWLS * MAX_FIGHTERS); fighters.count = 0; fighters.frustumCulled = false; fighters.userData = { visualRole: 'brawl-fighters' };
  fighters.instanceMatrix.setUsage(DynamicDrawUsage); fighters.instanceColor = new InstancedBufferAttribute(new Float32Array(BRAWLS * MAX_FIGHTERS * 3), 3).setUsage(DynamicDrawUsage);
  // Puffs: billboard quads with a procedural cloud texture and a per-instance alpha attribute.
  const puffTexture = makeTexture(options.createCanvas, 128, drawCloud), swordsTexture = makeTexture(options.createCanvas, 128, drawSwords);
  if (puffTexture) scope.add(puffTexture); if (swordsTexture) scope.add(swordsTexture);
  const quad = scope.add(new PlaneGeometry(1, 1)), puffGeometry = scope.add(quad.clone()), alphaAttr = new InstancedBufferAttribute(new Float32Array(BRAWLS * PUFFS_PER_BRAWL), 1).setUsage(DynamicDrawUsage);
  puffGeometry.setAttribute('aAlpha', alphaAttr);
  const puffMaterial = scope.add(new MeshBasicMaterial({ map: puffTexture, color: CREAM, transparent: true, depthWrite: false }));
  puffMaterial.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vAlpha;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAlpha;').replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\ndiffuseColor.a *= vAlpha;');
  };
  const puffs = new InstancedMesh(puffGeometry, puffMaterial, BRAWLS * PUFFS_PER_BRAWL); puffs.count = 0; puffs.frustumCulled = false; puffs.renderOrder = 4; puffs.userData = { visualRole: 'brawl-puffs' };
  puffs.instanceMatrix.setUsage(DynamicDrawUsage);
  const markerMaterial = scope.add(new MeshBasicMaterial({ map: swordsTexture, transparent: true, depthWrite: false, alphaTest: .02 }));
  const markers = new InstancedMesh(quad, markerMaterial, BRAWLS); markers.count = 0; markers.frustumCulled = false; markers.renderOrder = 5; markers.userData = { visualRole: 'brawl-marker' };
  markers.instanceMatrix.setUsage(DynamicDrawUsage);
  for (const mesh of [fighters, puffs, markers]) { scene.add(mesh); scope.defer(() => mesh.removeFromParent()); scope.defer(() => mesh.dispose()); }

  const matrix = new Matrix4(), position = new Vector3(), scale = new Vector3(), quaternion = new Quaternion(), billboard = new Quaternion(), UP = new Vector3(0, 1, 0);
  let fighterCountNow = 0, puffCountNow = 0, markerCountNow = 0;

  function slotFor(pair: string): Brawl | undefined {
    for (const s of slots) if (s.pair === pair && (s.active || s.vis > 0 || s.clashAt > -Infinity)) return s;
    for (const s of slots) if (!s.active && s.vis <= 0 && !burstAlive(s)) { reset(s, pair); return s; }
    return undefined;
  }
  function burstAlive(s: Brawl) { for (let k = 0; k < BURST_PUFFS; k++) if (s.burstBorn[k]! > -Infinity) return true; return false; }
  function reset(s: Brawl, pair: string) { s.pair = pair; s.pairH = pairHash(pair); s.active = false; s.vis = 0; s.ema = 0; s.pending = 0; s.clashAt = -Infinity; s.cursor = 0; s.seed = 0; s.burstBorn.fill(-Infinity); }
  function locate(s: Brawl, lane: Lane, split: number) {
    const a = view.towerStatic[lane.lo], b = view.towerStatic[lane.hi]; if (!a || !b) return;
    const ax = a.x / 1000, az = a.y / 1000, bx = b.x / 1000, bz = b.y / 1000, len = Math.hypot(bx - ax, bz - az) || 1;
    s.dx = (bx - ax) / len; s.dz = (bz - az) / len; s.x = ax + s.dx * split; s.z = az + s.dz * split; s.lo = lane.lo; s.hi = lane.hi; s.laneWidth = lane.widthWorld;
  }
  function laneSplit(lane: Lane) { const w = lane.mesh.userData.splitWorld as number | null; return typeof w === 'number' ? w : Number.isFinite(lane.split) ? lane.split * lane.length : lane.length / 2; }

  /** Clash events: counted for the intensity EMA and spawn a 6-puff burst at the split; allied (same-owner) lanes are ignored. */
  function consumeEvents(events: readonly SimEvent[], nextView = view) {
    if (disposed) return; view = nextView; const nn = view.towerStatic.length;
    for (const e of events) {
      if (e.type !== 'Clash') continue;
      const from = Math.floor(e.channel / nn), to = e.channel % nn, lane = options.lines.lanes.get(Math.min(from, to) * nn + Math.max(from, to));
      if (!lane || lane.owner[0] === lane.owner[1]) continue;
      const s = slotFor(lane.pair); if (!s) continue;
      locate(s, lane, laneSplit(lane)); s.pending++; s.clashAt = Math.max(s.clashAt, e.tick / TICK_RATE);
      if (!s.active && s.vis <= 0) s.seed = brawlSeed(s.pairH, e.tick);
      for (let k = 0; k < BURST_PUFFS; k++) { const i = s.cursor; s.cursor = (s.cursor + 1) % BURST_PUFFS; s.burstBorn[i] = e.tick / TICK_RATE; s.burstSeed[i] = brawlSeed(s.pairH, e.tick) ^ Math.imul(k + 1, 0x85ebca6b); s.burstX[i] = s.x; s.burstZ[i] = s.z; }
    }
  }

  function writePuff(index: number, x: number, y: number, z: number, size: number, alpha: number) {
    scale.set(size, size, 1); position.set(x, y, z); matrix.compose(position, billboard, scale); puffs.setMatrixAt(index, matrix); alphaAttr.array[index] = alpha;
  }
  /** `seconds` is the absolute render clock (same as troops/lines); `camera` orients billboards. */
  function update(seconds: number, camera: Camera, fronts?: TroopFronts) {
    if (disposed) return;
    const dt = lastSeconds === undefined ? 0 : Math.min(1, Math.max(0, seconds - lastSeconds)); lastSeconds = seconds;
    billboard.copy(camera.quaternion); const H = height;
    for (const s of slots) s.seen = false;
    for (const lane of options.lines.lanes.values()) {
      const shared = lane.state[0]! > 0 && lane.state[1]! > 0 && lane.owner[0] !== lane.owner[1];
      const both = shared && (fronts?.channelCount[lane.chan[0]!] ?? 0) > 0 && (fronts?.channelCount[lane.chan[1]!] ?? 0) > 0;
      let s: Brawl | undefined; for (const c of slots) if (c.pair === lane.pair && (c.active || c.vis > 0 || c.clashAt > -Infinity || burstAlive(c))) { s = c; break; }
      if (!s) { if (!both) continue; s = slotFor(lane.pair); if (!s) continue; s.seed = brawlSeed(s.pairH, Math.floor(seconds * TICK_RATE)); locate(s, lane, laneSplit(lane)); }
      s.seen = true; if (shared && lane.mesh.userData.splitWorld !== null) locate(s, lane, laneSplit(lane));
      s.active = shared && (both || seconds - s.clashAt <= RECENT_CLASH_S);
    }
    for (const s of slots) {
      if (!s.seen) s.active = false;
      if (dt > 0) { s.ema = stepClashEma(s.ema, s.pending, dt); s.pending = 0; s.vis = Math.min(1, Math.max(0, s.vis + (s.active ? dt : -dt) / FADE_S)); }
      else if (s.active && s.vis === 0) s.vis = 1;
      if (!s.active && s.vis <= 0 && s.clashAt > -Infinity && seconds - s.clashAt > RECENT_CLASH_S) s.clashAt = -Infinity;
    }
    let f = 0, p = 0, m = 0;
    for (const s of slots) {
      for (let k = 0; k < BURST_PUFFS; k++) {
        const born = s.burstBorn[k]!; if (born === -Infinity) continue;
        const age = Math.max(0, seconds - born);
        if (age >= PUFF_LIFE_S) { s.burstBorn[k] = -Infinity; continue; }
        const seed = s.burstSeed[k]!, t = age / PUFF_LIFE_S, ang = (k / BURST_PUFFS + hash01(seed, 1) * .5) * TAU, speed = H * (.9 + hash01(seed, 2) * .9) * (reduced ? 0 : 1);
        writePuff(p++, s.burstX[k]! + Math.cos(ang) * speed * age + (hash01(seed, 5) - .5) * H * .3, H * (.22 + .5 * t) + hash01(seed, 3) * H * .12, s.burstZ[k]! + Math.sin(ang) * speed * age + (hash01(seed, 6) - .5) * H * .3, H * (.55 + .9 * t), Math.min(1, t * 10) * (1 - t) * .9);
      }
      if (s.vis <= 0) { s.fighters = s.ambient = 0; continue; }
      const intensity = intensityOf(s.ema), nF = fighterCount(intensity), vis = s.vis; s.fighters = 0;
      // Fighters: side 0 stands toward the lower-index tower and faces along +d, side 1 the reverse.
      const nx = -s.dz, nz = s.dx, ownerLo = view.tower.owner[s.lo] ?? -1, ownerHi = view.tower.owner[s.hi] ?? -1;
      for (let side = 0; side < 2; side++) {
        const n = side === 0 ? Math.ceil(nF / 2) : Math.floor(nF / 2), sign = side === 0 ? -1 : 1, owner = side === 0 ? ownerLo : ownerHi;
        const tint = teamColors[owner >= 0 && owner < owners ? owner : 0]!;
        for (let i = 0; i < n; i++) {
          const q = side * MAX_FIGHTERS + i, phase = hash01(s.seed, q * 4) * TAU, freq = 5 + hash01(s.seed, q * 4 + 1) * 3;
          const lateral = (i - (n - 1) / 2) * H * .55 + (hash01(s.seed, q * 4 + 2) - .5) * H * .15, row = Math.floor(i / 2);
          const along = sign * (H * .32 + row * H * .1 - (reduced ? 0 : Math.sin(seconds * freq + phase) * H * .12));
          const hop = reduced ? 0 : Math.abs(Math.sin(seconds * freq * .9 + phase)) * H * .08;
          position.set(s.x + s.dx * along + nx * lateral, LANE_Y + hop, s.z + s.dz * along + nz * lateral);
          quaternion.setFromAxisAngle(UP, Math.atan2(s.dx * -sign, s.dz * -sign) + (reduced ? 0 : Math.sin(seconds * freq * .7 + phase) * .15));
          scale.setScalar(H * vis); matrix.compose(position, quaternion, scale); fighters.setMatrixAt(f, matrix); fighters.setColorAt(f, tint); f++; s.fighters++;
        }
      }
      // Ambient puffs: a stateless cycle per slot (rate 2-10/s), so the picture is a pure function of the render clock.
      const rate = puffRate(intensity), T = AMBIENT_PUFFS / rate, life = Math.min(PUFF_LIFE_S, T); s.ambient = 0;
      for (let j = 0; j < AMBIENT_PUFFS; j++) {
        const u = seconds + j * T / AMBIENT_PUFFS + hash01(s.pairH, 99) * T, cycle = Math.floor(u / T), age = u - cycle * T; if (age >= life) continue;
        const start = Math.floor((seconds - age) * TICK_RATE), seed = brawlSeed(s.pairH, start) ^ Math.imul(j + 1, 0x27d4eb2f), t = age / life, ang = hash01(seed, 1) * TAU, rad = H * (.25 + hash01(seed, 2) * .4);
        writePuff(p++, s.x + Math.cos(ang) * rad + s.dx * (reduced ? 0 : age * H * .2), H * (.18 + .55 * t) * (reduced ? .8 : 1) + hash01(seed, 3) * H * .2, s.z + Math.sin(ang) * rad, H * (.5 + .8 * t) * vis, Math.min(1, t * 8) * (1 - t) * .85 * vis); s.ambient++;
      }
      // Marker: billboard above the cluster; scale 0.8-1.2 by intensity.
      const ms = markerScale(intensity) * vis * H * .9;
      position.set(s.x, LANE_Y + MARKER_LIFT + H * 1.1, s.z); scale.set(ms, ms, 1); matrix.compose(position, billboard, scale); markers.setMatrixAt(m++, matrix);
    }
    fighters.count = fighterCountNow = f; puffs.count = puffCountNow = p; markers.count = markerCountNow = m;
    if (f) { fighters.instanceMatrix.needsUpdate = true; fighters.instanceColor!.needsUpdate = true; }
    if (p) { puffs.instanceMatrix.needsUpdate = true; alphaAttr.needsUpdate = true; }
    if (m) markers.instanceMatrix.needsUpdate = true;
  }
  function dispose() { if (disposed) return; disposed = true; fighters.count = puffs.count = markers.count = 0; scope.dispose(); }
  options.scope.defer(dispose);
  return {
    consumeEvents, update, dispose,
    setPalette(value: keyof Manifest['palettes']) { palette = value; paint(); },
    setReducedMotion(value: boolean) { reduced = value; },
    setFigureHeight(value: number) { if (value > 0) height = value; },
    get meshes(): readonly InstancedMesh[] { return [fighters, puffs, markers]; },
    get slots(): readonly Readonly<Brawl>[] { return slots; },
    get fighterCount() { return fighterCountNow; }, get puffCount() { return puffCountNow; }, get markerCount() { return markerCountNow; },
    get activeBrawls() { let c = 0; for (const s of slots) if (s.vis > 0) c++; return c; },
  };
}
