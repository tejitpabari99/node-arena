import { Group, TextureLoader, type Mesh, type Object3D } from 'three';
import type { SimEvent } from '@node-arena/defs';
import type { ManifestV2 } from '@node-arena/content';
import type { SimView, TroopBuffer } from '@node-arena/sim';
import { assertManifestReferences } from '../manifest/resolve.js';
import { defaultRegistry, type Renderer, type RendererContext, type RendererRegistry } from './registry.js';
import { MaterialCache, type TextureLoadFn } from './materials.js';
import { ModelCache, createBrowserGltfLoader, type GltfLoadFn } from './gltf-cache.js';
import { createEnvironment, type Environment } from './environment.js';
import { createGroundRenderer, type Bounds } from './ground-renderer.js';
import { createElementRenderer, type ElementInstance } from './element-renderer.js';
import { createLaneRenderer, type LanePoint } from './lane-renderer.js';
import { createUnitRenderer, type UnitRenderer } from './unit-renderer.js';
import { createBuildingFactory, type BuildingAnchor, type BuildingInit, type BuildingRenderer } from './building.js';
import { createCanvasLabelPainter, loadLabelFont, type LabelPainter } from './building-label.js';
import { createFxFactory, type FxCapacity, type FxRenderer } from './fx-pool.js';
import { createMirroredWorldRoot } from './world-root.js';

export { createMirroredWorldRoot } from './world-root.js';

/** Manifest visual id of the tower projectile (a `fx`-kind model). */
export const PROJECTILE_VISUAL = 'fx.projectile';

/** The slice of a `CompiledLevel` the renderer reads (a structural subset, so `CompiledLevel` is accepted as is). Coordinates are sim milli-units. */
export interface WorldLevel {
  bounds: Bounds;
  elements: readonly ElementInstance[];
  /** Array order = the dense building index used by `view.buildings`. */
  buildings: readonly { id: string; x: number; z: number; kind: 'house' | 'tower'; visual: string; footprint: { shape: 'circle' | 'box'; radius?: number; w?: number; d?: number } }[];
  units: readonly { visual: string }[];
  rules: { aliveCap: number };
}

/** Built by SP08 per render frame from `sim.view` / `sim.readTroops` (never a snapshot). */
export interface WorldFrame {
  view: SimView;
  troops: TroopBuffer;
  /** Rows of `troops` written by `sim.readTroops`. */
  n: number;
  /** Interpolation fraction in [0,1) between the last two ticks. */
  alpha: number;
  /** `sim.towerRadiusMilli` bound to its sim; enables the tower range rings (omit for none/fallback radius). */
  towerRadiusMilli?: (view: SimView, building: number) => number;
}

export interface WorldRendererOptions {
  /** The single mirrored root owned by SP08. Omitted: a mirrored root is created, added to `scene`, and removed on dispose. */
  worldRoot?: Object3D;
  /** Renderer registry (default: the process-wide one). Missing kinds are registered here, before the manifest is resolved. */
  registry?: RendererRegistry;
  /** Prefix for manifest-relative asset paths when using the default browser loaders. */
  baseURL?: string;
  textureLoader?: TextureLoadFn;
  gltfLoader?: GltfLoadFn;
  /** Inject shared caches (kept on dispose); otherwise the world creates and owns them. */
  materials?: MaterialCache;
  models?: ModelCache;
  /** One painter per building renderer (default: canvas painter with the Coiny font). */
  painter?: () => LabelPainter;
  fxCapacity?: Partial<FxCapacity>;
}

export interface WorldRenderer {
  /** Replaces all level content (ground, obstacles, lanes, buildings, units, fx, theme light). Caches are retained. */
  setLevel(level: WorldLevel, themeId: string): Promise<void>;
  update(frame: WorldFrame, events: readonly SimEvent[], dtMs: number): void;
  readonly anchors: { building(id: string): BuildingAnchor | undefined };
  /** Raycast targets of every building; `mesh.userData.buildingIndex` is the dense building index. */
  readonly pickMeshes: Mesh[];
  /** Drag preview; `from`/`to` are scene units in the data frame (x, z), `team` a colorKey. */
  previewLane(from: LanePoint, to: LanePoint, team?: string): void;
  clearPreview(): void;
  select(index: number | null): void;
  setShowTowerRanges(on: boolean): void;
  dispose(): void;
}

const radiusOf = (f: WorldLevel['buildings'][number]['footprint']): number => (f.shape === 'circle' ? (f.radius ?? 0) : Math.max(f.w ?? 0, f.d ?? 0) / 2);
let fontLoad: Promise<unknown> | null = null;

/**
 * Registers every SP07 renderer kind that is missing from `registry`. Call before resolving a manifest
 * (`assertManifestReferences` fails for unregistered kinds); `createWorldRenderer` calls it for you.
 */
export function registerWorldRenderers(registry: RendererRegistry, manifest: ManifestV2, opts: Pick<WorldRendererOptions, 'baseURL' | 'painter' | 'fxCapacity'> = {}): void {
  const reg = <T extends Renderer>(kind: Parameters<RendererRegistry['register']>[0], f: (ctx: RendererContext) => T | Promise<T>) => { if (!registry.has(kind)) registry.register(kind, f); };
  reg('ground', ctx => createGroundRenderer(ctx));
  reg('element', ctx => createElementRenderer(ctx));
  reg('lane', ctx => createLaneRenderer(ctx));
  reg('unit', ctx => createUnitRenderer(ctx));
  const projectileVisual = manifest.visuals[PROJECTILE_VISUAL];
  const makePainter = opts.painter ?? (() => createCanvasLabelPainter());
  const fontReady = opts.painter ? undefined : () => (fontLoad ??= loadLabelFont(opts.baseURL ?? '/'));
  reg('building', ctx => createBuildingFactory({ painter: makePainter(), ...(fontReady && { fontReady }), ...(projectileVisual && { projectile: { visualId: PROJECTILE_VISUAL, visual: projectileVisual } }) })(ctx));
  reg('fx', createFxFactory({ manifest, ...(opts.fxCapacity && { capacity: opts.fxCapacity }) }));
}

interface Content {
  group: Group; labels: Group;
  buildings: BuildingRenderer[]; byId: Map<string, BuildingRenderer>;
  units: UnitRenderer[]; fx: FxRenderer;
}

/**
 * The single seam SP08 consumes (PRD R5). Adds lights, ground, obstacles, lanes, units, buildings and FX to `scene`
 * (inside the mirrored worldRoot, except level labels, which sit in a sibling group of the root). Camera-agnostic: any
 * PerspectiveCamera works; art is tuned for FOV 21 / 55 deg pitch. SP08 owns the canvas, WebGLRenderer, camera, HUD and input.
 */
export function createWorldRenderer(scene: Object3D, manifest: ManifestV2, opts: WorldRendererOptions = {}): WorldRenderer {
  const registry = opts.registry ?? defaultRegistry;
  registerWorldRenderers(registry, manifest, opts);
  assertManifestReferences(manifest, registry);

  const ownsWorldRoot = !opts.worldRoot;
  const worldRoot = opts.worldRoot ?? createMirroredWorldRoot();
  if (ownsWorldRoot) scene.add(worldRoot);
  const base = opts.baseURL ?? '/';
  // Sync texture loader: renderers (lanes) request textures while being constructed, before any await.
  const tl = opts.textureLoader ? null : new TextureLoader();
  const texLoad: TextureLoadFn = opts.textureLoader ?? (p => tl!.load(`${base.replace(/\/$/, '')}/${p}`));
  let gltfLoad: GltfLoadFn | null = opts.gltfLoader ?? null;
  const materials = opts.materials ?? new MaterialCache(texLoad);
  const models = opts.models ?? new ModelCache(f => gltfLoad!(f));
  const ready = (async () => {
    if (!opts.models) gltfLoad ??= await createBrowserGltfLoader(base);
  })();

  const env: Environment = createEnvironment(manifest, materials, models);
  const labelRoot = new Group(); labelRoot.name = 'world:labels';
  const root = new Group(); root.name = 'world'; root.add(env.root);
  worldRoot.add(root); scene.add(labelRoot);

  let content: Content | null = null, gen = 0, selected: number | null = null, showRanges = true, disposed = false;

  const ctxFor = (id: string): RendererContext => ({ visualId: id, visual: manifest.visuals[id]!, materials, models });
  function drop(c: Content): void {
    for (const b of c.buildings) b.dispose();
    for (const u of c.units) u.dispose();
    c.fx.dispose();
    c.group.removeFromParent(); c.labels.removeFromParent();
  }

  const world: WorldRenderer = {
    async setLevel(level, themeId) {
      const mine = ++gen;
      await ready;
      await env.setLevel({ bounds: level.bounds, elements: level.elements }, themeId);
      env.lanes.clearPreview();
      const group = new Group(); group.name = 'world:level';
      const labels = new Group(); labels.name = 'world:level-labels';
      const buildings: BuildingRenderer[] = [], byId = new Map<string, BuildingRenderer>(), units: UnitRenderer[] = [];
      const partial: Content = { group, labels, buildings, byId, units, fx: null as never };
      try {
        const visuals = [...new Set(level.buildings.map(b => b.visual))];
        for (const v of visuals) {
          const r = await registry.get('building')(ctxFor(v)) as BuildingRenderer;
          buildings.push(r);
          const list: BuildingInit[] = [];
          level.buildings.forEach((b, index) => { if (b.visual === v) { list.push({ index, id: b.id, x: b.x, z: b.z, radius: radiusOf(b.footprint) }); byId.set(b.id, r); } });
          r.setBuildings(list); r.bindWorldRoot(worldRoot); r.select(selected); r.setShowTowerRanges(showRanges);
          group.add(r.root); labels.add(r.labelRoot);
        }
        const houses = level.buildings.filter(b => b.kind === 'house').length;
        for (const v of [...new Set(level.units.map(u => u.visual))]) {
          const u = await registry.get('unit')(ctxFor(v)) as UnitRenderer;
          units.push(u); u.setCapacity(houses, level.rules.aliveCap); group.add(u.root);
        }
        const fx = await registry.get('fx')(ctxFor(PROJECTILE_VISUAL)) as FxRenderer;
        partial.fx = fx; fx.setBuildings(level.buildings.map((b, index) => ({ index, x: b.x, z: b.z }))); group.add(fx.root);
      } catch (e) { if (partial.fx) drop(partial); else { for (const b of buildings) b.dispose(); for (const u of units) u.dispose(); } throw e; }
      if (mine !== gen || disposed) { drop(partial); return; } // superseded by a newer setLevel (or disposed) while loading
      if (content) drop(content);
      content = partial; root.add(group); labelRoot.add(labels);
    },

    update(frame, events, dtMs) {
      const c = content; if (!c) return;
      env.update(frame.view, dtMs);
      const sim = frame.towerRadiusMilli ? { towerRadiusMilli: frame.towerRadiusMilli } : undefined;
      for (const b of c.buildings) b.update({ view: frame.view }, events, dtMs, sim);
      for (const u of c.units) u.update(frame, events, dtMs);
      c.fx.update({ view: frame.view }, events, dtMs);
    },

    get anchors() { return { building: (id: string) => content?.byId.get(id)?.anchors.building(id) }; },
    get pickMeshes() { return content ? content.buildings.flatMap(b => b.pickMeshes) : []; },
    previewLane: (from, to, team) => env.lanes.previewLane(from, to, team),
    clearPreview: () => env.lanes.clearPreview(),
    select(index) { selected = index; content?.buildings.forEach(b => b.select(index)); },
    setShowTowerRanges(on) { showRanges = on; content?.buildings.forEach(b => b.setShowTowerRanges(on)); },

    dispose() {
      disposed = true; gen++;
      if (content) drop(content);
      content = null;
      env.dispose();
      root.removeFromParent(); labelRoot.removeFromParent();
      if (ownsWorldRoot) worldRoot.removeFromParent();
      if (!opts.materials) materials.dispose();
      if (!opts.models) models.dispose();
    },
  };
  return world;
}
