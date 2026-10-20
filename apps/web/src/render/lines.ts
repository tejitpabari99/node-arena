import { BufferAttribute, BufferGeometry, Mesh, Vector2, Vector3, type Camera, type Scene, type ShaderMaterial } from 'three';
import type { Manifest } from '@node-arena/content';
import type { SimEvent, SimView } from '@node-arena/sim';
import { createManifestResolver } from '../manifest/resolve.js';
import { Disposables } from './disposables.js';
import { createLaneMaterial, LANE_BUILD_S, LANE_FLASH_S, LANE_RETRACT_S, LANE_WIDTH_FACTOR } from './lane-material.js';
import { createPuffPool } from './puffs.js';
import { splitTarget, stepSplit } from './lane-split.js';
import { TICK_RATE } from '@node-arena/sim';
export interface LineSegment { readonly channel: number; readonly owner: number; readonly from: number; readonly to: number; readonly start: Vector3; readonly end: Vector3 }
export interface ProjectedLineSegment { readonly channel: number; readonly owner: number; readonly start: Vector2; readonly end: Vector2; /** Half the lane width in CSS pixels at the lane midpoint (perpendicular to the centre line). */ readonly halfWidthPx: number }
/** Read-only per-channel troop data filled by the troop renderer (`channel = from * n + to`, raw sim progress units). */
export interface TroopFronts { readonly frontProgress: ArrayLike<number>; readonly channelCount: ArrayLike<number> }
export interface LineRendererOptions { view: SimView; manifest: Manifest; scene: Scene; scope: Disposables; /** Tower visual width in world units (SP03 `towers.visualWidth`). */ visualWidth?: (id: string) => number | undefined; palette?: keyof Manifest['palettes']; reducedMotion?: boolean }
/** Half state: 0 absent, 1 drawn, 2 draining (cut but still carrying troops), 3 retracting (cut animation).
 * `buildAt`/`cutAt[side]` are render-clock start seconds: -1 none, NaN = starts at the next `update`. */
/** Lane draw order: recency rank among live lanes mapped into [1, 2) so lanes stay below every effect layer (fx 2, preview/trail 3, puffs 4, marker 5) and newer never inverts under older. */
export const laneOrder = (rank: number, count: number) => 1 + rank / Math.max(1, count);
export interface Lane { readonly mesh: Mesh<BufferGeometry, ShaderMaterial>; readonly lo: number; readonly hi: number; readonly pair: string; readonly chan: readonly [number, number]; readonly drawn: [boolean, boolean]; readonly owner: [number, number]; readonly state: [number, number]; seq: number; buildAt: number; buildSrc: number; readonly cutAt: [number, number]; widthWorld: number; readonly length: number; /** Sim-unit lane length (progress units). */ readonly simLength: number; /** Smoothed split (fraction from lo; NaN = unset) and spring velocity. */ split: number; splitV: number; /** Last computed target. */ splitTarget: number }
const LANE_Y = .04, PUFFS_PER_CUT = 4, easeOut = (t: number) => 1 - (1 - t) ** 2;
/** One flat chevron ribbon per unordered tower pair (A = lower index). */
export function createLineRenderer(options: LineRendererOptions) {
  const resolver = createManifestResolver(options.manifest), clock = { value: 0 }, motion = { value: options.reducedMotion ? 0 : 1 }, scope = new Disposables();
  const spring = new Float64Array(1);
  let lastSeconds: number | undefined, view = options.view, palette = options.palette ?? 'default', disposed = false, fronts: TroopFronts | undefined, hover: number | null = null, hoverOwner: number | undefined, now = 0, reduced = options.reducedMotion ?? false, animate = false;
  const puffs = createPuffPool(options.scene, scope, 16), lanes = new Map<number, Lane>(), meshes: Mesh<BufferGeometry, ShaderMaterial>[] = [], segments: LineSegment[] = [];
  const n = () => view.towerStatic.length, id = (i: number) => view.ids?.towers[i] ?? String(i);
  const color = (owner: number) => resolver.color(view.players[owner]?.colorKey ?? 'neutral', palette);
  function towerWidth(i: number) {
    const w = options.visualWidth?.(id(i)), r = view.towerStatic[i]!.footprintRadius / 1000;
    return w !== undefined && Number.isFinite(w) && w > 0 ? w : Number.isFinite(r) && r > 0 ? 2 * r : 6;
  }
  function laneWidth(a: number, b: number) { return LANE_WIDTH_FACTOR * (towerWidth(a) + towerWidth(b)) / 2; }
  function writeGeometry(lane: Lane) {
    const a = view.towerStatic[lane.lo]!, b = view.towerStatic[lane.hi]!, ax = a.x / 1000, az = a.y / 1000, bx = b.x / 1000, bz = b.y / 1000;
    const len = Math.hypot(bx - ax, bz - az) || 1, half = lane.widthWorld / 2, nx = -(bz - az) / len * half, nz = (bx - ax) / len * half;
    const pos = lane.mesh.geometry.getAttribute('position') as BufferAttribute;
    pos.set([ax - nx, LANE_Y, az - nz, ax + nx, LANE_Y, az + nz, bx - nx, LANE_Y, bz - nz, bx + nx, LANE_Y, bz + nz]); pos.needsUpdate = true;
    lane.mesh.geometry.computeBoundingSphere(); lane.mesh.geometry.computeBoundingBox();
    const u = lane.mesh.material.uniforms; u.laneLen!.value = len; u.laneW!.value = lane.widthWorld; u.fade!.value = Math.max(.5, (towerWidth(lane.lo) + towerWidth(lane.hi)) / 4);
  }
  function create(lo: number, hi: number): Lane {
    const geometry = new BufferGeometry(); geometry.setAttribute('position', new BufferAttribute(new Float32Array(12), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]), 2)); geometry.setIndex([0, 1, 2, 2, 1, 3]);
    const material = createLaneMaterial(clock, motion); material.uniforms.team = material.uniforms.colA!;
    const mesh = new Mesh(geometry, material), nn = n(), pair = `${id(lo)}-${id(hi)}`;
    const a = view.towerStatic[lo]!, b = view.towerStatic[hi]!, length = Math.hypot(b.x - a.x, b.y - a.y) / 1000;
    const lane: Lane = { mesh, lo, hi, pair, chan: [lo * nn + hi, hi * nn + lo], drawn: [false, false], owner: [-1, -1], state: [0, 0], seq: 0, buildAt: -1, buildSrc: 0, cutAt: [-1, -1], widthWorld: LANE_WIDTH_FACTOR * (towerWidth(lo) + towerWidth(hi)) / 2, length, simLength: Math.hypot(b.x - a.x, b.y - a.y) * TICK_RATE, split: NaN, splitV: 0, splitTarget: .5 };
    mesh.userData = { visualRole: 'lane', from: lo, to: hi, pair, widthWorld: lane.widthWorld, splitWorld: null };
    mesh.frustumCulled = false; options.scene.add(mesh); writeGeometry(lane); return lane;
  }
  function remove(key: number) {
    const lane = lanes.get(key); if (!lane) return; lanes.delete(key);
    lane.mesh.removeFromParent(); lane.mesh.geometry.dispose(); lane.mesh.material.dispose();
  }
  /** Rebuild pair state from `view.lines`; lanes persist while a drawn or troop-carrying channel remains. */
  function sync() {
    for (const lane of lanes.values()) lane.drawn[0] = lane.drawn[1] = false;
    segments.length = 0; const nn = n();
    for (const line of view.lines) {
      const lo = Math.min(line.from, line.to), hi = Math.max(line.from, line.to), key = lo * nn + hi;
      let lane = lanes.get(key); if (!lane) { lane = create(lo, hi); lanes.set(key, lane); }
      const side = line.from === lo ? 0 : 1, fresh = !lane.drawn[0] && !lane.drawn[1] && lane.state[0] === 0 && lane.state[1] === 0;
      if (fresh && animate && !reduced && lane.buildAt === -1) { lane.buildAt = now; lane.buildSrc = side; }
      lane.drawn[side] = true; lane.cutAt[side] = -1; lane.owner[side] = line.owner; lane.seq = Math.max(lane.seq, line.drawSeq ?? 0);
      const a = view.towerStatic[line.from]!, b = view.towerStatic[line.to]!;
      segments.push({ channel: line.channel, owner: line.owner, from: line.from, to: line.to, start: new Vector3(a.x / 1000, LANE_Y, a.y / 1000), end: new Vector3(b.x / 1000, LANE_Y, b.y / 1000) });
    }
    refresh();
  }
  function count(channel: number) { return fronts?.channelCount[channel] ?? 0; }
  /** Per-lane uniforms from pair state; prunes lanes with nothing left to show. */
  function refresh(dt = 0, snap = false) {
    let newest = -1; for (const l of lanes.values()) if (l.seq > newest) newest = l.seq;
    for (const [key, lane] of lanes) {
      let build = 1; if (lane.buildAt !== -1) { const t = (now - lane.buildAt) / LANE_BUILD_S; if (Number.isNaN(t)) build = 0; else if (t >= 1) lane.buildAt = -1; else build = easeOut(Math.max(0, t)); }
      const retract = [0, 0], flash = [0, 0];
      for (let s = 0; s < 2; s++) {
        let cutting = false;
        if (lane.cutAt[s] !== -1) { const age = now - lane.cutAt[s]!; if (Number.isNaN(age)) { cutting = true; flash[s] = 1; } else if (age >= LANE_RETRACT_S) lane.cutAt[s] = -1; else { cutting = true; retract[s] = Math.max(0, age) / LANE_RETRACT_S; flash[s] = age < LANE_FLASH_S ? 1 : 0; } }
        lane.state[s] = lane.drawn[s] ? 1 : cutting ? 3 : count(lane.chan[s]!) > 0 ? 2 : 0;
      }
      if (!lane.state[0] && !lane.state[1]) { remove(key); continue; }
      const u = lane.mesh.material.uniforms; u.buildT!.value = build; u.buildSrc!.value = lane.buildSrc; u.flashA!.value = flash[0]; u.flashB!.value = flash[1];
      const a = lane.state[0]! > 0, b = lane.state[1]! > 0;
      // Single-direction lanes run the full length with that owner's colour; shared lanes spring toward the front-progress split target.
      const ownerA = a ? lane.owner[0]! : lane.owner[1]!, ownerB = b ? lane.owner[1]! : lane.owner[0]!;
      (u.colA!.value as { set(v: string): void }).set(color(ownerA)); (u.colB!.value as { set(v: string): void }).set(color(ownerB));
      // Shared lane: spring toward the front-progress target; otherwise the single owner covers the whole lane.
      const present0 = lane.drawn[0] || count(lane.chan[0]!) > 0, present1 = lane.drawn[1] || count(lane.chan[1]!) > 0;
      lane.splitTarget = splitTarget(present0, present1, count(lane.chan[0]!), fronts?.frontProgress[lane.chan[0]!] ?? 0, count(lane.chan[1]!), fronts?.frontProgress[lane.chan[1]!] ?? 0, lane.simLength);
      if (!(a && b)) { lane.split = NaN; lane.splitV = 0; } // a lane that becomes shared starts at its target
      else if (snap || reduced || Number.isNaN(lane.split)) { lane.split = lane.splitTarget; lane.splitV = 0; }
      else { lane.split = stepSplit(lane.split, lane.splitV, lane.splitTarget, dt, spring); lane.splitV = spring[0]!; }
      u.split!.value = a && b ? lane.split : a ? 1 : 0; lane.mesh.userData.splitWorld = a && b ? lane.split * lane.length : null;
      // Retract shrinks the bright half toward its source; a half that still carries troops keeps the faded draining base underneath (no troops on bare grass).
      for (let s = 0; s < 2; s++) { (s === 0 ? u.retractA! : u.retractB!).value = lane.state[s] === 2 ? 1 : retract[s]!; (s === 0 ? u.keepA! : u.keepB!).value = lane.state[s]! >= 2 && count(lane.chan[s]!) > 0 ? 1 : 0; }
      u.drainA!.value = a && lane.state[0] === 2 ? 1 : 0; u.drainB!.value = b && lane.state[1] === 2 ? 1 : 0;
      u.hoverA!.value = hover !== null && hover === lane.chan[0] && (hoverOwner === undefined || hoverOwner === lane.owner[0]) ? 1 : 0;
      u.hoverB!.value = hover !== null && hover === lane.chan[1] && (hoverOwner === undefined || hoverOwner === lane.owner[1]) ? 1 : 0;
      let rank = 0; for (const o of lanes.values()) if (o.seq < lane.seq) rank++;
      lane.mesh.renderOrder = laneOrder(rank, lanes.size); u.alphaMul!.value = lane.seq === newest ? 1 : .82; // newer lane over older; older one slightly more see-through where lanes cross
    }
    meshes.length = 0; for (const lane of lanes.values()) meshes.push(lane.mesh);
  }
  /** Start a cut animation on the half whose channel was cut; spawns the midpoint puffs (seeded from pair + tick). */
  function cut(event: Extract<SimEvent, { type: 'LineCut' }>) {
    if (reduced || event.reason === 'replaced') return;
    const nn = n(), from = Math.floor(event.channel / nn), to = event.channel % nn, lo = Math.min(from, to), lane = lanes.get(lo * nn + Math.max(from, to)); if (!lane) return;
    lane.cutAt[from === lo ? 0 : 1] = NaN;
    const a = view.towerStatic[lane.lo]!, b = view.towerStatic[lane.hi]!;
    puffs.spawn((a.x + b.x) / 2000, LANE_Y + .4, (a.y + b.y) / 2000, (Math.imul(lane.lo * nn + lane.hi + 1, 0x9e3779b1) ^ Math.imul(event.tick | 0, 0x85ebca6b)) | 0, PUFFS_PER_CUT);
  }
  /** Finish every build/cut animation and clear puffs (harness `render({settle:true})`); `update` never calls this. */
  function settle() { for (const lane of lanes.values()) { lane.buildAt = -1; lane.cutAt[0] = lane.cutAt[1] = -1; } puffs.clear(); refresh(0, true); }
  function highlight(channel: number | null, owner?: number) { if (disposed || (hover === channel && hoverOwner === owner)) return; hover = channel; hoverOwner = owner; refresh(); }
  function dispose() { if (disposed) return; disposed = true; for (const key of [...lanes.keys()]) remove(key); meshes.length = segments.length = 0; scope.dispose(); }
  options.scope.defer(dispose); sync();
  return { get meshes(): readonly Mesh<BufferGeometry, ShaderMaterial>[] { return meshes; }, get lanes(): ReadonlyMap<number, Lane> { return lanes; }, get segments(): readonly LineSegment[] { return segments; },
    consumeEvents(events: readonly SimEvent[], nextView = view) {
      if (disposed) return; view = nextView; let changed = false;
      for (const e of events) { if (e.type === 'LineCut') { cut(e); changed = true; } else if (e.type === 'LineDrawn') changed = true; }
      if (changed) { animate = true; try { sync(); } finally { animate = false; } }
    },
    /** Seconds is the absolute render clock. Pass the troop renderer's fronts so cut channels still carrying troops stay drawn. */
    update(seconds: number, troops?: TroopFronts) { if (disposed) return; const dt = lastSeconds === undefined ? 0 : seconds - lastSeconds; lastSeconds = seconds; clock.value = now = seconds; if (troops) fronts = troops;
      for (const lane of lanes.values()) { if (Number.isNaN(lane.buildAt)) lane.buildAt = seconds; for (let s = 0; s < 2; s++) if (Number.isNaN(lane.cutAt[s]!)) lane.cutAt[s] = seconds; }
      puffs.update(seconds); refresh(dt); },
    settle,
    setPalette(value: keyof Manifest['palettes']) { if (disposed) return; palette = value; refresh(); },
    setReducedMotion(value: boolean) { motion.value = value ? 0 : 1; reduced = value; if (value) settle(); },
    get puffs() { return puffs; },
    highlight, setHighlighted: highlight,
    /** Lane ribbon width in world units for a tower pair (used by the draw preview). */
    laneWidth,
    /** Caller may cache this until line changes or camera resize. Coordinates are CSS pixels. Both channels of a pair project onto the same centre line. */
    projectSegments(camera: Camera, viewportWidth: number, viewportHeight: number): ProjectedLineSegment[] {
      const px = (p: Vector3) => new Vector2((p.x+1)*viewportWidth/2,(1-p.y)*viewportHeight/2), nn = n();
      return segments.map(segment => { const a = segment.start.clone().project(camera), b = segment.end.clone().project(camera), lo = Math.min(segment.from, segment.to), hi = Math.max(segment.from, segment.to);
        const half = (lanes.get(lo * nn + hi)?.widthWorld ?? laneWidth(lo, hi)) / 2, mid = segment.start.clone().add(segment.end).multiplyScalar(.5), dx = segment.end.x - segment.start.x, dz = segment.end.z - segment.start.z, len = Math.hypot(dx, dz) || 1;
        const side = mid.clone().add(new Vector3(-dz / len * half, 0, dx / len * half)).project(camera), m = mid.clone().project(camera);
        return { channel: segment.channel, owner: segment.owner, start: px(a), end: px(b), halfWidthPx: px(side).distanceTo(px(m)) }; });
    }, dispose,
  };
}
