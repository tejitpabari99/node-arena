import { Box3, Color, Matrix4, Raycaster, SRGBColorSpace, Vector2, Vector3, type Camera, type InstancedBufferAttribute, type Object3D } from 'three';
import type { SimEvent, SimView } from '@node-arena/sim';
import { EVENT_FX_LOCATORS } from '../render/fx.js';

/**
 * Probe contract (SP01, PRD "Probe"). Renderers tag objects non-visually via `userData`:
 * - `visualRole: 'tower'` on each tower root (any non-InstancedMesh object), identified by `towerIndex` (sim index) or
 *   `towerId` (sim tower id; a one-element `towerIds` also works); optional `paintColor` (hex), `floors`, `slotDots`,
 *   `visualWidthWorld` (alias `visualWidth`), `stackHeight` (world u, plinth to roof top).
 *   Mesh path: descendants tagged `visualPart: 'model'` bound the model rect (else the whole root minus `count`).
 *   Instanced path: when the root has no geometry (empty `Group`, towers drawn by shared `InstancedMesh`es tagged
 *   `visualRole: 'tower'` with `towerIds[]` = instance -> tower id), the model rect is the projected box centred on the
 *   root world position, `visualWidthWorld` wide/deep, from root y to `stackHeight` (default
 *   `floors x FLOOR_HEIGHT_WORLD + 0.5 x visualWidthWorld`; floors default 1). Shared tower InstancedMeshes are never roots.
 * - `visualRole: 'count'` on the roof number decal mesh: inside its tower root, or one shared `InstancedMesh` with
 *   `towerIds[]` (each instance's geometry box under its instance matrix; zero-scale instances are skipped).
 * - `visualRole: 'lane'` on each lane mesh with `from`/`to` tower indices and `pair` ('lowId-highId');
 *   optional `widthWorld` and `splitWorld` (world distance from the lower-index tower).
 * - `visualRole: 'troop'` on troop InstancedMeshes (`troopPose` x/z per instance) with optional `heightWorld`, `widthWorld`, `baseY`.
 * - `visualRole: 'ground'` on ground, border, props and rocks; optional `playQuad` ([x,z][4] world corners of the grass patch).
 * Missing optional fields are reported as null; null never passes a metric.
 */
export interface Rect { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }
export interface VisualProbe {
  viewport: { w: number; h: number }; clearColor: string;
  ground: { cornerRayHits: boolean[]; playQuadScreen: Point[] | null };
  towers: { id: string; owner: string | null; count: number; cap: number | null; floors: number | null; model: Rect; countRect: Rect | null; countOnRoof: boolean; slotDots: number; hasCard: boolean; paintHue: number | null; visualWidthWorld: number | null }[];
  lanes: { from: string; to: string; pair: string; widthWorld: number | null; screenWidthPx: number | null; splitWorld: number | null; splitScreen: Point | null; mid: Point }[];
  troops: { count: number; screenHeightPx: number | null; sampleRects: Rect[] };
  clash: { fxScreen: Point | null; eventScreen: Point | null; eventTick: number | null; eventPair: string | null };
}
/** Optional renderer-module hooks driven by the harness (`render({settle})`, per-tick `step`). */
export interface HarnessRendererHooks { settle?(): void; advance?(dt: number): void }
export interface ProbeInput {
  scene: Object3D; camera: Camera; view: SimView; events: readonly SimEvent[];
  viewport: { w: number; h: number }; clearColor: string;
  /** DOM label card present for tower index (page DOM, not a renderer flag). */
  hasCard(index: number): boolean;
  /** FX meshes; a visible one sitting on the latest Clash point gives `clash.fxScreen`. */
  fx: readonly Object3D[];
}

const SAMPLE_TROOPS = 8;
/** Default floor height (world u) for the instanced-tower stack-height fallback (SP03 PRD R7: floor height ~0.9 u). */
export const FLOOR_HEIGHT_WORLD = 0.9;
const round = (v: number) => Math.round(v * 1000) / 1000;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function buildVisualProbe(input: ProbeInput): VisualProbe {
  const { scene, camera, view, viewport } = input;
  scene.updateMatrixWorld(true); camera.updateMatrixWorld();
  const ids = view.ids.towers, players = view.ids.players;
  const point = (p: Vector3): Point => { const q = p.clone().project(camera); return { x: round((q.x + 1) * viewport.w / 2), y: round((1 - q.y) * viewport.h / 2) }; };
  const rectOf = (points: Point[]): Rect | null => {
    if (!points.length) return null;
    const xs = points.map(p => p.x), ys = points.map(p => p.y), x = Math.min(...xs), y = Math.min(...ys);
    return { x: round(x), y: round(y), w: round(Math.max(...xs) - x), h: round(Math.max(...ys) - y) };
  };
  const boxCorners = (box: Box3) => { const out: Vector3[] = []; for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push(new Vector3(x, y, z)); return out; };
  /** Tight screen rect: every mesh's local geometry box corners, transformed and projected. */
  const meshPoints = (root: Object3D, skip: (o: Object3D) => boolean) => {
    const out: Point[] = [], world = new Box3();
    const visit = (node: Object3D) => {
      if (skip(node) || !node.visible || isShared(node)) return;
      const geometry = (node as Object3D & { geometry?: { boundingBox: Box3 | null; computeBoundingBox(): void } }).geometry;
      if (geometry) {
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        for (const c of boxCorners(geometry.boundingBox!)) { const w = c.applyMatrix4(node.matrixWorld); world.expandByPoint(w); out.push(point(w)); }
      }
      for (const child of node.children) visit(child);
    };
    visit(root); return { points: out, world };
  };
  /** Shared instanced parts (`towerIds[]` on an InstancedMesh) span many towers; never traversed as one tower's mesh. */
  function isShared(node: Object3D) { return (node as Object3D & { isInstancedMesh?: boolean }).isInstancedMesh === true && Array.isArray(node.userData.towerIds); }
  /** World boxes of the instances of `mesh` that belong to tower `id` (zero-scale = hidden instances skipped). */
  const instanceBoxes = (mesh: Object3D, id: string) => {
    const inst = mesh as Object3D & { count: number; getMatrixAt(i: number, m: Matrix4): void; geometry: { boundingBox: Box3 | null; computeBoundingBox(): void } };
    const towerIds = mesh.userData.towerIds as unknown[], out: { points: Point[]; world: Box3 }[] = [], m = new Matrix4();
    if (!mesh.visible) return out;
    if (!inst.geometry.boundingBox) inst.geometry.computeBoundingBox();
    for (let k = 0; k < Math.min(inst.count, towerIds.length); k++) {
      if (towerIds[k] !== id) continue;
      inst.getMatrixAt(k, m); if (Math.abs(m.determinant()) < 1e-12) continue;
      m.premultiply(mesh.matrixWorld);
      const world = new Box3(), points = boxCorners(inst.geometry.boundingBox!).map(c => { const w = c.applyMatrix4(m); world.expandByPoint(w); return point(w); });
      out.push({ points, world });
    }
    return out;
  };
  const tagged: Record<string, Object3D[]> = {};
  scene.traverse(node => { const role = node.userData.visualRole; if (typeof role === 'string') (tagged[role] ??= []).push(node); });
  const pairOf = (a: number, b: number) => `${ids[Math.min(a, b)]}-${ids[Math.max(a, b)]}`;

  const raycaster = new Raycaster(), grounds = tagged.ground ?? [], cornerRayHits: boolean[] = [];
  for (const y of [1, 0, -1]) for (const x of [-1, 0, 1]) { raycaster.setFromCamera(new Vector2(x, y), camera); cornerRayHits.push(raycaster.intersectObjects(grounds, true).length > 0); }
  const quad = grounds.map(g => g.userData.playQuad).find(q => Array.isArray(q) && q.length === 4) as [number, number][] | undefined;
  const playQuadScreen = quad ? quad.map(([x, z]) => point(new Vector3(x, 0, z))) : null;

  const towerRoots = new Map<number, Object3D>();
  for (const root of tagged.tower ?? []) {
    if (isShared(root)) continue;
    const d = root.userData, single = Array.isArray(d.towerIds) && d.towerIds.length === 1 ? d.towerIds[0] : undefined;
    const tid = typeof d.towerId === 'string' ? d.towerId : typeof single === 'string' ? single : undefined;
    const i = num(d.towerIndex) ?? (tid === undefined ? -1 : ids.indexOf(tid));
    if (i !== null && i >= 0 && i < ids.length) towerRoots.set(i, root);
  }
  const sharedCounts = (tagged.count ?? []).filter(isShared);
  const garrison = view.tower.col['garrison.count'], caps = view.tower.col['garrison.cap'];
  const towers: VisualProbe['towers'] = [];
  for (let i = 0; i < ids.length; i++) {
    const root = towerRoots.get(i); if (!root) continue;
    const parts: Object3D[] = []; root.traverse(n => { if (n.userData.visualPart === 'model') parts.push(n); });
    const isCount = (o: Object3D) => o.userData.visualRole === 'count';
    const visualWidthWorld = num(root.userData.visualWidthWorld) ?? num(root.userData.visualWidth), floors = num(root.userData.floors);
    let modelPts = (parts.length ? parts : [root]).map(p => meshPoints(p, isCount));
    if (!modelPts.some(m => m.points.length) && visualWidthWorld !== null) {
      // Instanced path: no own geometry, derive the stack box from the root transform.
      const base = root.getWorldPosition(new Vector3()), half = visualWidthWorld / 2;
      const height = num(root.userData.stackHeight) ?? (floors ?? 1) * FLOOR_HEIGHT_WORLD + 0.5 * visualWidthWorld;
      const world = new Box3(new Vector3(base.x - half, base.y, base.z - half), new Vector3(base.x + half, base.y + height, base.z + half));
      modelPts = [{ points: boxCorners(world).map(point), world }];
    }
    const modelWorld = modelPts.reduce((box, m) => box.union(m.world), new Box3());
    const model = rectOf(modelPts.flatMap(m => m.points)) ?? { x: 0, y: 0, w: 0, h: 0 };
    const counts: Object3D[] = []; root.traverse(n => { if (isCount(n)) counts.push(n); });
    const count = [...counts.map(c => meshPoints(c, () => false)), ...sharedCounts.flatMap(c => instanceBoxes(c, ids[i]!))].filter(c => c.points.length);
    const countRect = rectOf(count.flatMap(c => c.points));
    let countOnRoof = false;
    if (countRect && !modelWorld.isEmpty()) {
      const cx = countRect.x + countRect.w / 2, cy = countRect.y + countRect.h / 2;
      const top = modelWorld.min.y + (modelWorld.max.y - modelWorld.min.y) / 2;
      countOnRoof = cx >= model.x && cx <= model.x + model.w && cy >= model.y && cy <= model.y + model.h && count.every(c => c.world.min.y >= top);
    }
    const owner = view.tower.owner[i]!, paint = root.userData.paintColor;
    towers.push({
      id: ids[i]!, owner: owner < 0 ? null : players[owner] ?? null, count: garrison?.[i] ?? 0, cap: caps?.[i] ?? null,
      floors, model, countRect, countOnRoof, slotDots: num(root.userData.slotDots) ?? 0, hasCard: input.hasCard(i),
      paintHue: typeof paint === 'string' ? round(new Color(paint).getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace).h * 360) : null,
      visualWidthWorld,
    });
  }

  const lanes: VisualProbe['lanes'] = [];
  for (const mesh of tagged.lane ?? []) {
    const from = num(mesh.userData.from), to = num(mesh.userData.to); if (from === null || to === null) continue;
    const box = meshPoints(mesh, () => false).world, centre = box.isEmpty() ? new Vector3() : box.getCenter(new Vector3());
    const lo = view.towerStatic[Math.min(from, to)]!, hi = view.towerStatic[Math.max(from, to)]!;
    const start = new Vector3(lo.x / 1000, 0, lo.y / 1000), dir = new Vector3(hi.x / 1000, 0, hi.y / 1000).sub(start).normalize();
    const widthWorld = num(mesh.userData.widthWorld), splitWorld = num(mesh.userData.splitWorld);
    let screenWidthPx: number | null = null;
    if (widthWorld !== null) {
      const normal = new Vector3(-dir.z, 0, dir.x).multiplyScalar(widthWorld / 2);
      const a = point(centre.clone().add(normal)), b = point(centre.clone().sub(normal)); screenWidthPx = round(Math.hypot(a.x - b.x, a.y - b.y));
    }
    lanes.push({ from: ids[from]!, to: ids[to]!, pair: typeof mesh.userData.pair === 'string' ? mesh.userData.pair : pairOf(from, to), widthWorld, screenWidthPx,
      splitWorld, splitScreen: splitWorld === null ? null : point(start.clone().addScaledVector(dir, splitWorld).setY(centre.y)), mid: point(centre) });
  }

  let troopCount = 0; const heights: number[] = [], sampleRects: Rect[] = [];
  for (const mesh of tagged.troop ?? []) {
    const n = num((mesh as Object3D & { count?: number }).count) ?? 0; troopCount += n;
    const pose = (mesh as Object3D & { geometry?: { getAttribute(name: string): InstancedBufferAttribute | undefined } }).geometry?.getAttribute('troopPose');
    const h = num(mesh.userData.heightWorld), w = num(mesh.userData.widthWorld) ?? (h ?? 0) * .6, base = num(mesh.userData.baseY) ?? 0;
    if (!pose || h === null) continue;
    for (let i = 0; i < n && sampleRects.length < SAMPLE_TROOPS; i++) {
      const x = pose.array[i * 4]!, z = pose.array[i * 4 + 1]!;
      const foot = point(new Vector3(x, base, z)), head = point(new Vector3(x, base + h, z)); heights.push(Math.hypot(foot.x - head.x, foot.y - head.y));
      sampleRects.push(rectOf(boxCorners(new Box3(new Vector3(x - w / 2, base, z - w / 2), new Vector3(x + w / 2, base + h, z + w / 2))).map(point))!);
    }
  }
  heights.sort((a, b) => a - b);

  let last: Extract<SimEvent, { type: 'Clash' }> | undefined;
  for (const event of input.events) if (event.type === 'Clash' && (!last || event.tick >= last.tick)) last = event;
  const clash: VisualProbe['clash'] = { fxScreen: null, eventScreen: null, eventTick: null, eventPair: null };
  const target = new Vector3();
  if (last && EVENT_FX_LOCATORS.Clash!(last, view, target) !== undefined) {
    const n = ids.length;
    clash.eventTick = last.tick; clash.eventPair = pairOf(Math.floor(last.channel / n), last.channel % n); clash.eventScreen = point(target);
    const fx = input.fx.find(m => m.visible && m.position.distanceTo(target) < 1e-6); if (fx) clash.fxScreen = point(fx.position);
  }
  return { viewport: { w: viewport.w, h: viewport.h }, clearColor: input.clearColor, ground: { cornerRayHits, playQuadScreen }, towers, lanes,
    troops: { count: troopCount, screenHeightPx: heights.length ? round(heights[Math.floor(heights.length / 2)]!) : null, sampleRects }, clash };
}
