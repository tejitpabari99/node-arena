import { Box3, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial, Sphere, Vector3, type BufferGeometry, type Material, type Object3D, type Scene } from 'three';
import { isqrt, TICK_RATE, type Sim, type TroopBuf } from '@node-arena/sim';
import type { Manifest } from '@node-arena/content';
import { createManifestResolver } from '../manifest/resolve.js';
import { Disposables } from './disposables.js';
import { mergeModel } from './model.js';
import { patchTroopMaterial } from './troop-material.js';
import { buildLowTroopGeometry, createLodPolicy, type LodThresholds, type TroopLod, type TroopLodMode } from './troop-lod.js';
export interface TroopRendererOptions {
  sim: Pick<Sim, 'view' | 'readTroops'>;
  manifest: Manifest;
  models: ReadonlyMap<string, Object3D>;
  scene: Scene;
  scope: Disposables;
  initialCapacity?: number;
  reducedMotion?: boolean;
  palette?: keyof Manifest['palettes'];
  /** 'auto' (default) picks high/low by live count + frame-time EMA; 'high'/'low' force one set (`?lod=` harness param). */
  lod?: TroopLodMode;
  /** Multiplier on the troop visual scale (SP05 rollout, see `troopSizeFactor`); default 1. */
  sizeFactor?: number;
  /** Overrides of the auto thresholds (SP05 perf ladder / quality tiers); defaults are the exported LOD_* constants. */
  lodThresholds?: Partial<LodThresholds>;
  /** Wall-clock source in milliseconds for the auto policy's frame-time EMA (the app passes its own clock; omitted = count-only policy). */
  now?: () => number;
}
interface LodSet {
  template: BufferGeometry; materials: Material[]; mesh: InstancedMesh;
  animation: ReturnType<typeof patchTroopMaterial>[]; pose: Float32Array;
  /** Probe tag (test-harness visualProbe) copied onto each mesh; no effect on rendering. */
  tag: Record<string, string | number>;
}
/** One bucket per (visual, owner): a high-detail and a low-detail instanced set sharing capacity and pose indices. */
interface Bucket extends LodSet { capacity: number; count: number; total: number; low: LodSet }
function buffer(capacity: number): TroopBuf {
  return { channel: new Int32Array(capacity), seq: new Int32Array(capacity), owner: new Int32Array(capacity), kind: new Int32Array(capacity), progress: new Int32Array(capacity) };
}
/** Per-level troop size overrides keyed by level id (render params only; M06 troop height / tower width <= 0.60). */
export const TROOP_SIZE_OVERRIDE: Readonly<Record<string, number>> = { '09-chain-link': 0.9 };
/** Troop size factor for a level: shrinks troops on boards whose starting (owned) towers are small (median visual width < 4 u), times the per-level override. */
export function troopSizeFactor(levelId: string, ownedTowerWidths: readonly number[]): number {
  const w = [...ownedTowerWidths].filter(x => Number.isFinite(x) && x > 0).sort((a, b) => a - b), median = w.length ? w[Math.floor(w.length / 2)]! : 4;
  return Math.min(1, median / 4) * (TROOP_SIZE_OVERRIDE[levelId] ?? 1);
}
/** Public view/readTroops boundary only. Channels remain renderable after their draw line is cut. */
export function createTroopRenderer(options: TroopRendererOptions) {
  const { sim, scene, manifest } = options, view = sim.view, scope = new Disposables();
  const resolver = createManifestResolver(manifest), clock = { value: 0 };
  const n = view.towerStatic.length, channels = new Float64Array(n * n * 6);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let from = 0; from < n; from++) {
    const a = view.towerStatic[from]!;
    minX = Math.min(minX, a.x / 1000); maxX = Math.max(maxX, a.x / 1000); minZ = Math.min(minZ, a.y / 1000); maxZ = Math.max(maxZ, a.y / 1000);
    for (let to = 0; to < n; to++) {
      const b = view.towerStatic[to]!, dx = b.x - a.x, dz = b.y - a.y, offset = (from * n + to) * 6;
      channels[offset] = a.x / 1000; channels[offset + 1] = a.y / 1000; channels[offset + 2] = dx / 1000; channels[offset + 3] = dz / 1000;
      channels[offset + 4] = isqrt((dx * TICK_RATE) ** 2 + (dz * TICK_RATE) ** 2);
      // The packed shader rotates x/z as a plane; models face local +z.
      channels[offset + 5] = -Math.atan2(dx, dz);
    }
  }
  if (!n) minX = maxX = minZ = maxZ = 0;
  const center = new Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2), mapRadius = Math.hypot(maxX - minX, maxZ - minZ) / 2;
  const frontProgress = new Int32Array(n * n), channelCount = new Int32Array(n * n);
  let capacity = Math.max(1, Math.ceil(options.initialCapacity ?? 128)), buf = buffer(capacity), live = 0, disposed = false;
  const mode = options.lod ?? 'auto', policy = createLodPolicy(options.lodThresholds), now = options.now ?? (() => 0); // no clock -> no frame-time EMA (count-only policy); render code must stay clock-free (determinism lint)
  let lod: TroopLod = mode === 'low' ? 'low' : 'high';
  const buckets: Bucket[] = [], meshes: InstancedMesh[] = [], lowMeshes: InstancedMesh[] = [], byVisual = new Map<string, Bucket[]>(), kindBuckets: Bucket[][] = [];
  const identity = new Matrix4();
  function makeMesh(bucket: Pick<LodSet, 'template' | 'materials' | 'tag'>, size: number) {
    const geometry = bucket.template.clone();
    geometry.setAttribute('troopPose', new InstancedBufferAttribute(new Float32Array(size * 4), 4).setUsage(DynamicDrawUsage));
    const mesh = new InstancedMesh(geometry, bucket.materials, size);
    for (let i = 0; i < size; i++) mesh.setMatrixAt(i, identity);
    mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
    const visualRadius = geometry.boundingSphere?.radius ?? 1;
    mesh.boundingSphere = new Sphere(center.clone(), mapRadius + visualRadius); mesh.userData = { ...bucket.tag }; scene.add(mesh); return mesh;
  }
  try {
    for (const kind of view.kinds) {
      let owners = byVisual.get(kind.visual);
      if (!owners) {
        const base = resolver.visual(kind.visual, 'troop'), visual = { ...base, scale: base.scale * (options.sizeFactor ?? 1) }, source = options.models.get(visual.modelKey);
        if (!source) throw new Error(`Missing loaded model: ${visual.modelKey}`);
        const merged = mergeModel(source, visual.teamMaterial, scope);
        // Fixed bound encloses model scale, offsets and procedural motion for every pose.
        const modelRadius = (merged.geometry.boundingSphere?.center.length() ?? 0) + (merged.geometry.boundingSphere?.radius ?? 1);
        merged.geometry.boundingSphere = new Sphere(new Vector3(), modelRadius * visual.scale + Math.abs(visual.yOffset ?? 0) + (visual.anim?.type === 'bob' ? visual.anim.amp : 0));
        owners = [];
        const box = merged.geometry.boundingBox, s = visual.scale;
        const tag = { visualRole: 'troop', lod: 'high', heightWorld: box ? (box.max.y - box.min.y) * s : 0, widthWorld: box ? Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * s : 0, baseY: (visual.yOffset ?? 0) + (box ? box.min.y * s : 0) };
        // Low set: same height/footprint/baseY tags and the same patched-material contract (shared troopScale, yOffset, gait height).
        const lowTemplate = scope.add(buildLowTroopGeometry(box ?? new Box3(new Vector3(-.5, 0, -.5), new Vector3(.5, 1, .5)))), lowTag = { ...tag, lod: 'low' };
        for (let owner = 0; owner < view.players.length; owner++) {
          const team = new Color(resolver.color(view.players[owner]!.colorKey, options.palette));
          const materials = merged.materials.map(m => { const copy = m.clone(); scope.material(copy, false); return copy; });
          const animation = materials.map(m => patchTroopMaterial(m, visual, team, merged.hasTeamMaterial, clock, options.reducedMotion ?? false, box ? box.max.y - box.min.y : 1));
          const mesh = makeMesh({ template: merged.geometry, materials, tag }, capacity);
          const pose = mesh.geometry.getAttribute('troopPose').array as Float32Array;
          const lowMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: 0, emissive: new Color('#262626') }); scope.material(lowMaterial, false);
          const lowMaterials = [lowMaterial], lowAnimation = lowMaterials.map(m => patchTroopMaterial(m, visual, team, true, clock, options.reducedMotion ?? false, box ? box.max.y - box.min.y : 1));
          const lowMesh = makeMesh({ template: lowTemplate, materials: lowMaterials, tag: lowTag }, capacity);
          const low = { template: lowTemplate, materials: lowMaterials, mesh: lowMesh, animation: lowAnimation, pose: lowMesh.geometry.getAttribute('troopPose').array as Float32Array, tag: lowTag };
          const bucket = { template: merged.geometry, materials, mesh, capacity, count: 0, total: 0, animation, pose, tag, low }; owners.push(bucket); buckets.push(bucket); meshes.push(mesh); lowMeshes.push(lowMesh);
        }
        byVisual.set(kind.visual, owners);
      }
      kindBuckets.push(owners);
    }
  } catch (error) { for (const mesh of [...meshes, ...lowMeshes]) { mesh.removeFromParent(); mesh.dispose(); mesh.geometry.dispose(); } scope.dispose(); throw error; }
  function dispose() {
    if (disposed) return; disposed = true;
    for (const bucket of buckets) for (const set of [bucket, bucket.low]) { set.mesh.removeFromParent(); set.mesh.dispose(); set.mesh.geometry.dispose(); }
    scope.dispose();
  }
  options.scope.defer(dispose);
  function update(alpha: number, seconds: number) {
    if (disposed) return;
    clock.value = seconds; live = sim.readTroops(buf);
    while (live > capacity) { do { capacity *= 2; } while (live > capacity); buf = buffer(capacity); live = sim.readTroops(buf); }
    for (const bucket of buckets) bucket.count = 0;
    for (let i = 0; i < live; i++) kindBuckets[buf.kind[i]!]![buf.owner[i]!]!.count++;
    for (let b = 0; b < buckets.length; b++) {
      const bucket = buckets[b]!;
      if (bucket.count > bucket.capacity) {
        do { bucket.capacity *= 2; } while (bucket.count > bucket.capacity);
        for (const [set, list] of [[bucket, meshes], [bucket.low, lowMeshes]] as const) {
          const old = set.mesh; set.mesh = makeMesh(set, bucket.capacity); list[b] = set.mesh;
          set.pose = set.mesh.geometry.getAttribute('troopPose').array as Float32Array;
          old.removeFromParent(); old.dispose(); old.geometry.dispose();
        }
      }
    }
    // LOD decision. Above the low-count threshold only the low set gets pose data; at or below it (auto) both are written, so a swap is just `count`.
    if (mode === 'auto') lod = policy.update(live, now() / 1000);
    const writeHigh = mode === 'high' || (mode === 'auto' && live <= policy.thresholds.lowCount), writeLow = mode === 'low' || (mode === 'auto' && live <= policy.thresholds.lowCount) || lod === 'low';
    for (const bucket of buckets) {
      bucket.mesh.count = lod === 'high' ? bucket.count : 0; bucket.low.mesh.count = lod === 'low' ? bucket.count : 0;
      bucket.total = bucket.count; bucket.count = 0;
    }
    frontProgress.fill(0); channelCount.fill(0);
    for (let i = 0; i < live; i++) {
      const ch = buf.channel[i]!; channelCount[ch]!++; if (buf.progress[i]! > frontProgress[ch]!) frontProgress[ch] = buf.progress[i]!;
      const kind = buf.kind[i]!, bucket = kindBuckets[kind]![buf.owner[i]!]!, offset = buf.channel[i]! * 6;
      const length = channels[offset + 4]!, t = length ? Math.min(1, Math.max(0, (buf.progress[i]! + alpha * view.kinds[kind]!.speedPerTick) / length)) : 1;
      const at = bucket.count++ * 4, x = channels[offset]! + t * channels[offset + 2]!, z = channels[offset + 1]! + t * channels[offset + 3]!, rot = channels[offset + 5]!, seq = buf.seq[i]!;
      if (writeHigh) { const data = bucket.pose; data[at] = x; data[at + 1] = z; data[at + 2] = rot; data[at + 3] = seq; }
      if (writeLow) { const data = bucket.low.pose; data[at] = x; data[at + 1] = z; data[at + 2] = rot; data[at + 3] = seq; }
    }
    for (const bucket of buckets) for (const [set, write] of [[bucket, writeHigh], [bucket.low, writeLow]] as const) if (write) {
      const pose = set.mesh.geometry.getAttribute('troopPose') as InstancedBufferAttribute; pose.clearUpdateRanges(); pose.addUpdateRange(0, bucket.total * 4); pose.needsUpdate = true;
    }
  }
  return { update, dispose, get count() { return live; },
    /** Read-only per channel (`from * n + to`): max (front) raw sim progress and troop count, refreshed each update. */
    get frontProgress(): Readonly<Int32Array> { return frontProgress; }, get channelCount(): Readonly<Int32Array> { return channelCount; },
    /** All instanced meshes: the high set per bucket, then the low set per bucket (`userData.lod`). Allocates; harness use only. */
    get meshes(): readonly InstancedMesh[] { return [...meshes, ...lowMeshes]; },
    /** Effective LOD of the last update ('high' | 'low'); the requested mode is `lodMode`. */
    get lod(): TroopLod { return lod; }, get lodMode(): TroopLodMode { return mode; },
    setReducedMotion(value: boolean) { for (const bucket of buckets) for (const animation of [...bucket.animation, ...bucket.low.animation]) animation.setReducedMotion(value); },
    setPalette(palette: keyof Manifest['palettes']) { for (const owners of byVisual.values()) for (let owner = 0; owner < owners.length; owner++) {
      // Team Color instances are held by compiled material uniforms; mutate rather than recompile.
      const color = new Color(resolver.color(view.players[owner]!.colorKey, palette));
      for (const animation of [...owners[owner]!.animation, ...owners[owner]!.low.animation]) animation.setTeamColor(color);
    } },
  };
}
