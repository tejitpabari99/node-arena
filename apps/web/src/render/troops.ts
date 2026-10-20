import { Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, Sphere, Vector3, type BufferGeometry, type Material, type Object3D, type Scene } from 'three';
import { isqrt, TICK_RATE, type Sim, type TroopBuf } from '@node-arena/sim';
import type { Manifest } from '@node-arena/content';
import { createManifestResolver } from '../manifest/resolve.js';
import { Disposables } from './disposables.js';
import { mergeModel } from './model.js';
import { patchTroopMaterial } from './troop-material.js';
export interface TroopRendererOptions {
  sim: Pick<Sim, 'view' | 'readTroops'>;
  manifest: Manifest;
  models: ReadonlyMap<string, Object3D>;
  scene: Scene;
  scope: Disposables;
  initialCapacity?: number;
  reducedMotion?: boolean;
  palette?: keyof Manifest['palettes'];
}
interface Bucket {
  template: BufferGeometry; materials: Material[]; mesh: InstancedMesh; capacity: number; count: number;
  animation: ReturnType<typeof patchTroopMaterial>[]; pose: Float32Array;
  /** Probe tag (test-harness visualProbe) copied onto each mesh; no effect on rendering. */
  tag: Record<string, string | number>;
}
function buffer(capacity: number): TroopBuf {
  return { channel: new Int32Array(capacity), seq: new Int32Array(capacity), owner: new Int32Array(capacity), kind: new Int32Array(capacity), progress: new Int32Array(capacity) };
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
  const buckets: Bucket[] = [], meshes: InstancedMesh[] = [], byVisual = new Map<string, Bucket[]>(), kindBuckets: Bucket[][] = [];
  const identity = new Matrix4();
  function makeMesh(bucket: Pick<Bucket, 'template' | 'materials' | 'tag'>, size: number) {
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
        const visual = resolver.visual(kind.visual, 'troop'), source = options.models.get(visual.modelKey);
        if (!source) throw new Error(`Missing loaded model: ${visual.modelKey}`);
        const merged = mergeModel(source, visual.teamMaterial, scope);
        // Fixed bound encloses model scale, offsets and procedural motion for every pose.
        const modelRadius = (merged.geometry.boundingSphere?.center.length() ?? 0) + (merged.geometry.boundingSphere?.radius ?? 1);
        merged.geometry.boundingSphere = new Sphere(new Vector3(), modelRadius * visual.scale + Math.abs(visual.yOffset ?? 0) + (visual.anim?.type === 'bob' ? visual.anim.amp : 0));
        owners = [];
        const box = merged.geometry.boundingBox, s = visual.scale;
        const tag = { visualRole: 'troop', heightWorld: box ? (box.max.y - box.min.y) * s : 0, widthWorld: box ? Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * s : 0, baseY: (visual.yOffset ?? 0) + (box ? box.min.y * s : 0) };
        for (let owner = 0; owner < view.players.length; owner++) {
          const team = new Color(resolver.color(view.players[owner]!.colorKey, options.palette));
          const materials = merged.materials.map(m => { const copy = m.clone(); scope.material(copy, false); return copy; });
          const animation = materials.map(m => patchTroopMaterial(m, visual, team, merged.hasTeamMaterial, clock, options.reducedMotion ?? false));
          const mesh = makeMesh({ template: merged.geometry, materials, tag }, capacity);
          const pose = mesh.geometry.getAttribute('troopPose').array as Float32Array;
          const bucket = { template: merged.geometry, materials, mesh, capacity, count: 0, animation, pose, tag }; owners.push(bucket); buckets.push(bucket); meshes.push(mesh);
        }
        byVisual.set(kind.visual, owners);
      }
      kindBuckets.push(owners);
    }
  } catch (error) { for (const mesh of meshes) { mesh.removeFromParent(); mesh.dispose(); mesh.geometry.dispose(); } scope.dispose(); throw error; }
  function dispose() {
    if (disposed) return; disposed = true;
    for (const bucket of buckets) { bucket.mesh.removeFromParent(); bucket.mesh.dispose(); bucket.mesh.geometry.dispose(); }
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
        const old = bucket.mesh; bucket.mesh = makeMesh(bucket, bucket.capacity); meshes[b] = bucket.mesh;
        bucket.pose = bucket.mesh.geometry.getAttribute('troopPose').array as Float32Array;
        old.removeFromParent(); old.dispose(); old.geometry.dispose();
      }
      bucket.mesh.count = bucket.count; bucket.count = 0;
    }
    frontProgress.fill(0); channelCount.fill(0);
    for (let i = 0; i < live; i++) {
      const ch = buf.channel[i]!; channelCount[ch]!++; if (buf.progress[i]! > frontProgress[ch]!) frontProgress[ch] = buf.progress[i]!;
      const kind = buf.kind[i]!, bucket = kindBuckets[kind]![buf.owner[i]!]!, offset = buf.channel[i]! * 6;
      const length = channels[offset + 4]!, t = length ? Math.min(1, Math.max(0, (buf.progress[i]! + alpha * view.kinds[kind]!.speedPerTick) / length)) : 1;
      const data = bucket.pose, at = bucket.count++ * 4;
      data[at] = channels[offset]! + t * channels[offset + 2]!; data[at + 1] = channels[offset + 1]! + t * channels[offset + 3]!;
      data[at + 2] = channels[offset + 5]!; data[at + 3] = buf.seq[i]!;
    }
    for (const bucket of buckets) { const pose = bucket.mesh.geometry.getAttribute('troopPose') as InstancedBufferAttribute; pose.clearUpdateRanges(); pose.addUpdateRange(0, bucket.mesh.count * 4); pose.needsUpdate = true; }
  }
  return { update, dispose, get count() { return live; },
    /** Read-only per channel (`from * n + to`): max (front) raw sim progress and troop count, refreshed each update. */
    get frontProgress(): Readonly<Int32Array> { return frontProgress; }, get channelCount(): Readonly<Int32Array> { return channelCount; }, get meshes(): readonly InstancedMesh[] { return meshes; },
    setReducedMotion(value: boolean) { for (const bucket of buckets) for (const animation of bucket.animation) animation.setReducedMotion(value); },
    setPalette(palette: keyof Manifest['palettes']) { for (const owners of byVisual.values()) for (let owner = 0; owner < owners.length; owner++) {
      // Team Color instances are held by compiled material uniforms; mutate rather than recompile.
      const color = new Color(resolver.color(view.players[owner]!.colorKey, palette));
      for (const animation of owners[owner]!.animation) animation.setTeamColor(color);
    } },
  };
}
