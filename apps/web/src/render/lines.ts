import { BufferAttribute, BufferGeometry, Mesh, Vector2, Vector3, type Camera, type Scene, type ShaderMaterial } from 'three';
import type { Manifest } from '@node-arena/content';
import type { SimEvent, SimView } from '@node-arena/sim';
import { createManifestResolver } from '../manifest/resolve.js';
import { Disposables } from './disposables.js';
import { createLaneMaterial, LANE_WIDTH_FACTOR } from './lane-material.js';
export interface LineSegment { readonly channel: number; readonly owner: number; readonly from: number; readonly to: number; readonly start: Vector3; readonly end: Vector3 }
export interface ProjectedLineSegment { readonly channel: number; readonly owner: number; readonly start: Vector2; readonly end: Vector2 }
/** Read-only per-channel troop data filled by the troop renderer (`channel = from * n + to`, raw sim progress units). */
export interface TroopFronts { readonly frontProgress: ArrayLike<number>; readonly channelCount: ArrayLike<number> }
export interface LineRendererOptions { view: SimView; manifest: Manifest; scene: Scene; scope: Disposables; /** Tower visual width in world units (SP03 `towers.visualWidth`). */ visualWidth?: (id: string) => number | undefined; palette?: keyof Manifest['palettes']; reducedMotion?: boolean }
/** Half state: 0 absent, 1 drawn, 2 draining (cut but still carrying troops). */
export interface Lane { readonly mesh: Mesh<BufferGeometry, ShaderMaterial>; readonly lo: number; readonly hi: number; readonly pair: string; readonly chan: readonly [number, number]; readonly drawn: [boolean, boolean]; readonly owner: [number, number]; readonly state: [number, number]; seq: number; widthWorld: number; readonly length: number }
const LANE_Y = .04;
/** One flat chevron ribbon per unordered tower pair (A = lower index). */
export function createLineRenderer(options: LineRendererOptions) {
  const resolver = createManifestResolver(options.manifest), clock = { value: 0 }, motion = { value: options.reducedMotion ? 0 : 1 }, scope = new Disposables();
  let view = options.view, palette = options.palette ?? 'default', disposed = false, fronts: TroopFronts | undefined, hover: number | null = null, hoverOwner: number | undefined;
  const lanes = new Map<number, Lane>(), meshes: Mesh<BufferGeometry, ShaderMaterial>[] = [], segments: LineSegment[] = [];
  const n = () => view.towerStatic.length, id = (i: number) => view.ids?.towers[i] ?? String(i);
  const color = (owner: number) => resolver.color(view.players[owner]?.colorKey ?? 'neutral', palette);
  function towerWidth(i: number) {
    const w = options.visualWidth?.(id(i)), r = view.towerStatic[i]!.footprintRadius / 1000;
    return w !== undefined && Number.isFinite(w) && w > 0 ? w : Number.isFinite(r) && r > 0 ? 2 * r : 6;
  }
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
    const lane: Lane = { mesh, lo, hi, pair, chan: [lo * nn + hi, hi * nn + lo], drawn: [false, false], owner: [-1, -1], state: [0, 0], seq: 0, widthWorld: LANE_WIDTH_FACTOR * (towerWidth(lo) + towerWidth(hi)) / 2, length };
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
      const side = line.from === lo ? 0 : 1; lane.drawn[side] = true; lane.owner[side] = line.owner; lane.seq = Math.max(lane.seq, line.drawSeq ?? 0);
      const a = view.towerStatic[line.from]!, b = view.towerStatic[line.to]!;
      segments.push({ channel: line.channel, owner: line.owner, from: line.from, to: line.to, start: new Vector3(a.x / 1000, LANE_Y, a.y / 1000), end: new Vector3(b.x / 1000, LANE_Y, b.y / 1000) });
    }
    refresh();
  }
  function count(channel: number) { return fronts?.channelCount[channel] ?? 0; }
  /** Per-lane uniforms from pair state; prunes lanes with nothing left to show. */
  function refresh() {
    for (const [key, lane] of lanes) {
      for (let s = 0; s < 2; s++) lane.state[s] = lane.drawn[s] ? 1 : count(lane.chan[s]!) > 0 ? 2 : 0;
      if (!lane.state[0] && !lane.state[1]) { remove(key); continue; }
      const u = lane.mesh.material.uniforms, a = lane.state[0]! > 0, b = lane.state[1]! > 0;
      // Single-direction lanes run the full length with that owner's colour; shared lanes default to the midpoint (Task 4 drives the live split).
      const ownerA = a ? lane.owner[0]! : lane.owner[1]!, ownerB = b ? lane.owner[1]! : lane.owner[0]!;
      (u.colA!.value as { set(v: string): void }).set(color(ownerA)); (u.colB!.value as { set(v: string): void }).set(color(ownerB));
      u.split!.value = a && b ? .5 : a ? 1 : 0;
      u.drainA!.value = a && lane.state[0] === 2 ? 1 : 0; u.drainB!.value = b && lane.state[1] === 2 ? 1 : 0;
      u.hoverA!.value = hover !== null && hover === lane.chan[0] && (hoverOwner === undefined || hoverOwner === lane.owner[0]) ? 1 : 0;
      u.hoverB!.value = hover !== null && hover === lane.chan[1] && (hoverOwner === undefined || hoverOwner === lane.owner[1]) ? 1 : 0;
      lane.mesh.renderOrder = 1 + lane.seq % 100;
    }
    meshes.length = 0; for (const lane of lanes.values()) meshes.push(lane.mesh);
  }
  function highlight(channel: number | null, owner?: number) { if (disposed || (hover === channel && hoverOwner === owner)) return; hover = channel; hoverOwner = owner; refresh(); }
  function dispose() { if (disposed) return; disposed = true; for (const key of [...lanes.keys()]) remove(key); meshes.length = segments.length = 0; scope.dispose(); }
  options.scope.defer(dispose); sync();
  return { get meshes(): readonly Mesh<BufferGeometry, ShaderMaterial>[] { return meshes; }, get lanes(): ReadonlyMap<number, Lane> { return lanes; }, get segments(): readonly LineSegment[] { return segments; },
    consumeEvents(events: readonly SimEvent[], nextView = view) { if (disposed) return; view = nextView; if (events.some(e => e.type === 'LineDrawn' || e.type === 'LineCut')) sync(); },
    /** Seconds is the absolute render clock. Pass the troop renderer's fronts so cut channels still carrying troops stay drawn. */
    update(seconds: number, troops?: TroopFronts) { if (disposed) return; clock.value = seconds; if (troops) fronts = troops; refresh(); },
    setPalette(value: keyof Manifest['palettes']) { if (disposed) return; palette = value; refresh(); },
    setReducedMotion(value: boolean) { motion.value = value ? 0 : 1; },
    highlight, setHighlighted: highlight,
    /** Caller may cache this until line changes or camera resize. Coordinates are CSS pixels. Both channels of a pair project onto the same centre line. */
    projectSegments(camera: Camera, viewportWidth: number, viewportHeight: number): ProjectedLineSegment[] {
      return segments.map(segment => { const a = segment.start.clone().project(camera), b = segment.end.clone().project(camera); return { channel: segment.channel, owner: segment.owner,
        start: new Vector2((a.x+1)*viewportWidth/2,(1-a.y)*viewportHeight/2), end: new Vector2((b.x+1)*viewportWidth/2,(1-b.y)*viewportHeight/2) }; });
    }, dispose,
  };
}
