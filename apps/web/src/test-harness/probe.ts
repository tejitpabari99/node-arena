import { Box3, Color, Raycaster, SRGBColorSpace, Vector2, Vector3, type Camera, type InstancedBufferAttribute, type Object3D } from 'three';
import type { SimEvent, SimView } from '@node-arena/sim';
import { EVENT_FX_LOCATORS } from '../render/fx.js';

/**
 * Probe contract (SP01, PRD "Probe"). Renderers tag objects non-visually via `userData`:
 * - `visualRole: 'tower'` on each tower root, with `towerIndex`; optional `paintColor` (hex), `floors`, `slotDots`, `visualWidthWorld`.
 *   Descendants tagged `visualPart: 'model'` bound the model rect (else the whole root minus `count`).
 * - `visualRole: 'count'` on the roof number decal mesh (inside its tower root).
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
      if (skip(node) || !node.visible) return;
      const geometry = (node as Object3D & { geometry?: { boundingBox: Box3 | null; computeBoundingBox(): void } }).geometry;
      if (geometry) {
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        for (const c of boxCorners(geometry.boundingBox!)) { const w = c.applyMatrix4(node.matrixWorld); world.expandByPoint(w); out.push(point(w)); }
      }
      for (const child of node.children) visit(child);
    };
    visit(root); return { points: out, world };
  };
  const tagged: Record<string, Object3D[]> = {};
  scene.traverse(node => { const role = node.userData.visualRole; if (typeof role === 'string') (tagged[role] ??= []).push(node); });
  const pairOf = (a: number, b: number) => `${ids[Math.min(a, b)]}-${ids[Math.max(a, b)]}`;

  const raycaster = new Raycaster(), grounds = tagged.ground ?? [], cornerRayHits: boolean[] = [];
  for (const y of [1, 0, -1]) for (const x of [-1, 0, 1]) { raycaster.setFromCamera(new Vector2(x, y), camera); cornerRayHits.push(raycaster.intersectObjects(grounds, true).length > 0); }
  const quad = grounds.map(g => g.userData.playQuad).find(q => Array.isArray(q) && q.length === 4) as [number, number][] | undefined;
  const playQuadScreen = quad ? quad.map(([x, z]) => point(new Vector3(x, 0, z))) : null;

  const towerRoots = new Map<number, Object3D>();
  for (const root of tagged.tower ?? []) { const i = num(root.userData.towerIndex); if (i !== null) towerRoots.set(i, root); }
  const garrison = view.tower.col['garrison.count'], caps = view.tower.col['garrison.cap'];
  const towers: VisualProbe['towers'] = [];
  for (let i = 0; i < ids.length; i++) {
    const root = towerRoots.get(i); if (!root) continue;
    const parts: Object3D[] = []; root.traverse(n => { if (n.userData.visualPart === 'model') parts.push(n); });
    const isCount = (o: Object3D) => o.userData.visualRole === 'count';
    const modelPts = (parts.length ? parts : [root]).map(p => meshPoints(p, isCount));
    const modelWorld = modelPts.reduce((box, m) => box.union(m.world), new Box3());
    const model = rectOf(modelPts.flatMap(m => m.points)) ?? { x: 0, y: 0, w: 0, h: 0 };
    const counts: Object3D[] = []; root.traverse(n => { if (isCount(n)) counts.push(n); });
    const count = counts.map(c => meshPoints(c, () => false));
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
      floors: num(root.userData.floors), model, countRect, countOnRoof, slotDots: num(root.userData.slotDots) ?? 0, hasCard: input.hasCard(i),
      paintHue: typeof paint === 'string' ? round(new Color(paint).getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace).h * 360) : null,
      visualWidthWorld: num(root.userData.visualWidthWorld),
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
