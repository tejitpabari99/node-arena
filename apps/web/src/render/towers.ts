import { Box3, Matrix4, CanvasTexture, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, Vector3, type Camera, type Color, type Material, type Object3D } from 'three';
import type { Manifest } from '@node-arena/content';
import type { SimView } from '@node-arena/sim';
import { createManifestResolver } from '../manifest/resolve.js';
import { Disposables } from './disposables.js';
import { cloneModel } from './model.js';
import { createRoofAtlas, dotStates, roofText, type RoofAtlas } from './roof-texture.js';
import { createTowerMeshes, floorsFor, stackHeight, towerWidth, type StackedTowerSpec, type TowerMeshes } from './tower-mesh.js';
import { createOverlayRegistry, readOverlays, type OverlayRegistry } from './overlays.js';

type ColoredMaterial = Material & { color: Color };
function isColored(material: Material): material is ColoredMaterial { return 'color' in material; }
export interface TowerPresentation {
  readonly group: Group;
  readonly model: Object3D;
  readonly base: Mesh<CylinderGeometry, MeshStandardMaterial>;
  readonly baseMarker: Mesh<PlaneGeometry, MeshBasicMaterial>;
  readonly roofMarker: Mesh<PlaneGeometry, MeshBasicMaterial>;
  /** Stacked build: width (world u) and mesh index into the shared instanced set. */
  readonly stacked?: { width: number; index: number };
}
export interface TowerRendererOptions {
  view: SimView;
  manifest: Manifest;
  models: ReadonlyMap<string, Object3D>;
  scene: Object3D;
  camera: Camera;
  parent: HTMLElement;
  scope: Disposables;
  overlays?: OverlayRegistry;
  colorblind?: boolean;
}
/** Per-level individual groups. Models own scope geometry/texture wrappers and materials; decoded images remain cache-owned. */
export function createTowerRenderer(options: TowerRendererOptions) {
  const scope = new Disposables(); options.scope.defer(() => scope.dispose());
  const resolver = createManifestResolver(options.manifest), registry = options.overlays ?? createOverlayRegistry();
  const towers: TowerPresentation[] = [], teamMaterials: ColoredMaterial[][] = [], previousTeams: string[] = [];
  const textures = new Map<string, CanvasTexture>(); let clock = 0, disposed = false, colorblind = options.colorblind ?? false;
  const markerTexture = (glyph: string) => {
    const existing = textures.get(glyph); if (existing) return existing;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Tower markers require a 2D canvas');
    ctx.fillStyle = '#111827'; ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 88px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(glyph, 64, 66, 116);
    const texture = scope.add(new CanvasTexture(canvas)); texture.colorSpace = SRGBColorSpace; textures.set(glyph, texture); return texture;
  };
  const marker = (size: number) => {
    const mesh = new Mesh(new PlaneGeometry(size, size), new MeshBasicMaterial({ color: '#ffffff', depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    mesh.rotation.x = -Math.PI / 2; scope.object(mesh, { textures: false }); return mesh;
  };
  // One visually-hidden live region replaces the per-tower DOM label cards (accessible description of every tower, updated on change).
  const summary = scope.label(document.createElement('div'));
  summary.setAttribute('data-tower-summary', ''); summary.setAttribute('role', 'status'); summary.setAttribute('aria-live', 'polite');
  summary.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0;pointer-events:none';
  options.parent.appendChild(summary);
  // Stacked towers (manifest `build: 'stacked'`) are code-built instanced meshes shared by all towers; others use their model.
  const specs: StackedTowerSpec[] = [], stackedIndex: number[] = [];
  for (let i = 0; i < options.view.towerStatic.length; i++) {
    const tower = options.view.towerStatic[i]!, visual = resolver.visual(tower.visual, 'tower');
    if (visual.build !== 'stacked') { stackedIndex.push(-1); continue; }
    stackedIndex.push(specs.length); specs.push({ id: options.view.ids.towers[i]!, x: tower.x / 1000, z: tower.y / 1000, width: towerWidth(tower.footprintRadius / 1000, visual.scale) });
  }
  const atlas: RoofAtlas | undefined = specs.length ? scope.add(createRoofAtlas(specs.length)) : undefined;
  const meshes: TowerMeshes | undefined = specs.length ? createTowerMeshes(specs, atlas) : undefined;
  if (meshes) { options.scene.add(meshes.group); scope.defer(() => meshes.dispose()); }
  try {
    for (let i = 0; i < options.view.towerStatic.length; i++) {
      const tower = options.view.towerStatic[i]!, visual = resolver.visual(tower.visual, 'tower');
      const stacked = stackedIndex[i]! >= 0 ? specs[stackedIndex[i]!]! : undefined;
      if (stacked) {
        const group = new Group(), model = new Group(), height = stackHeight(5, stacked.width), radius = stacked.width / 2;
        group.position.set(stacked.x, 0, stacked.z); group.matrixAutoUpdate = false; group.matrix.makeTranslation(stacked.x, 0, stacked.z); group.matrixWorldNeedsUpdate = true; // matrix carries the lean-cancelling shear (refreshShear)
        const base = new Mesh(new CylinderGeometry(.01, .01, .01, 3), new MeshStandardMaterial()); base.visible = false; scope.object(base);
        // The roof decal (atlas) carries the count, dots and colourblind glyph; these planes stay hidden and only keep the glyph in userData for tests.
        const baseMarker = marker(Math.min(radius * .5, 1.8)), roofMarker = marker(Math.max(.4, stacked.width * .5));
        baseMarker.position.set(0, .13, radius * .78); baseMarker.visible = false; roofMarker.position.y = height; roofMarker.visible = false; roofMarker.userData.visualRole = 'marker';
        group.userData = { visualRole: 'tower', towerIndex: i, visualWidth: stacked.width, floors: 1, stackHeight: stackHeight(1, stacked.width) };
        group.add(model, base, baseMarker, roofMarker); options.scene.add(group); scope.defer(() => group.removeFromParent());
        towers.push({ group, model, base, baseMarker, roofMarker, stacked: { width: stacked.width, index: stackedIndex[i]! } }); teamMaterials.push([]);
        continue;
      }
      const source = options.models.get(visual.modelKey); if (!source) throw new Error(`Missing loaded model: ${visual.modelKey}`);
      const group = new Group(), model = cloneModel(source, scope), colors: ColoredMaterial[] = [];
      group.position.set(tower.x / 1000, 0, tower.y / 1000); model.scale.setScalar(visual.scale); model.position.y = visual.yOffset ?? 0;
      model.traverse(node => { if (node instanceof Mesh) {
        node.castShadow = true; node.receiveShadow = true;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          if (!isColored(material)) continue;
          if (visual.tint) material.color.set(visual.tint);
          if (visual.teamMaterial && material.name === visual.teamMaterial && !colors.includes(material)) colors.push(material);
        }
      } });
      group.add(model); const physical = new Box3().setFromObject(model), size = physical.getSize(new Vector3());
      const radius = Math.max(tower.footprintRadius / 1000, Math.hypot(size.x, size.z) / 2 + .5, .5);
      const base = new Mesh(new CylinderGeometry(radius, radius, .12, 8), new MeshStandardMaterial());
      base.position.y = .06; base.receiveShadow = true; scope.object(base); group.add(base);
      const baseMarker = marker(Math.min(radius * .5, 1.8)), roofMarker = marker(Math.max(.4, Math.min(size.x, size.z, 2)));
      baseMarker.position.set(0, .13, radius * .78); roofMarker.position.y = Math.max(physical.max.y, .13) + .02;
      // Probe tags only (test-harness visualProbe); no effect on rendering.
      group.userData = { visualRole: 'tower', towerIndex: i }; model.userData.visualPart = 'model';       group.add(baseMarker, roofMarker); options.scene.add(group); scope.defer(() => group.removeFromParent());
      towers.push({ group, model, base, baseMarker, roofMarker }); teamMaterials.push(colors);
    }
  } catch (error) { scope.dispose(); throw error; }
  const signatures: string[] = [], descriptions: string[] = []; let summaryText = '';
  const update = (view: SimView, settings: { colorblind?: boolean } = {}) => {
    if (disposed) return;
    if (view.towerStatic.length !== towers.length) throw new Error('Create a new tower renderer when changing levels');
    colorblind = settings.colorblind ?? colorblind;
    for (let i = 0; i < towers.length; i++) {
      const tower = towers[i]!, owner = view.tower.owner[i]!, colorKey = owner < 0 ? 'neutral' : view.players[owner]!.colorKey;
      const color = resolver.color(colorKey, colorblind ? 'colorblind' : 'default'), glyph = resolver.marker(colorKey);
      const team = `${color}\0${glyph}`;
      if (tower.stacked && meshes) {
        const floors = floorsFor(view.tower.col['garrison.count']?.[i] ?? 0, view.tower.col['garrison.cap']?.[i]);
        if (meshes.setState(tower.stacked.index, { floors, color: owner < 0 ? null : color }, clock)) {
          tower.group.userData.floors = floors; tower.group.userData.stackHeight = stackHeight(floors, tower.stacked.width); tower.roofMarker.position.y = stackHeight(floors, tower.stacked.width) + .02;
        }
        tower.baseMarker.visible = false; tower.roofMarker.visible = false;
      }
      const count = view.tower.col['garrison.count']?.[i] ?? 0, cap = view.tower.col['garrison.cap']?.[i] ?? null, slots = view.tower.slots?.[i] ?? 0, lines = view.tower.lines?.[i] ?? 0;
      const signature = `${owner}|${count}|${cap}|${slots}|${lines}|${colorblind}`;
      if (signatures[i] !== signature) {
        signatures[i] = signature;
        // Overlay registry feeds the decal: garrison -> number, drawsLines ('●' = line out, '○' = free) -> dots.
        const values = readOverlays(registry, view.towerStatic[i]!.components, view, i), byKey = new Map(values.map(value => [value.key, value]));
        const draws = byKey.get('drawsLines')?.text ?? '', dots = byKey.has('garrison') || draws ? dotStates(draws.length, [...draws].filter(c => c === '●').length) : [];
        if (tower.stacked && atlas) atlas.set(tower.stacked.index, { text: byKey.has('garrison') ? roofText(count, cap) : '', dots, glyph: colorblind ? glyph : '' });
        tower.group.userData.slotDots = dots.length; tower.group.userData.cap = cap;
        descriptions[i] = [`Tower ${view.ids.towers[i]}`, owner < 0 ? 'neutral' : `${view.players[owner]!.colorKey} ${glyph}`, cap !== null && count >= cap ? 'Max' : '', ...values.map(value => value.description)].filter(Boolean).join(', ');
      }
      if (previousTeams[i] !== team) {
        tower.base.material.color.set(color); for (const material of teamMaterials[i]!) material.color.set(color);
        for (const mesh of [tower.baseMarker, tower.roofMarker]) {
          const texture = markerTexture(glyph); if (mesh.material.map !== texture) { mesh.material.map = texture; mesh.material.needsUpdate = true; }
          mesh.userData.glyph = glyph;
        }
        previousTeams[i] = team; tower.group.userData.paintColor = color;
      }
    }
    atlas?.flush();
    const next = descriptions.join('. '); if (next !== summaryText) { summaryText = next; summary.textContent = next; }
  };
  /** Cancels perspective lean per tower: shear so the stack's top projects straight above its base (like the refs' near-orthographic camera). */
  const refreshShear = () => {
    if (!meshes || disposed) return;
    options.camera.updateMatrixWorld(); const base = new Vector3(), top = new Vector3(), side = new Vector3(), rootM = new Matrix4(), H = 10;
    for (const tower of towers) { if (!tower.stacked) continue;
      const { x, z } = tower.group.position; base.set(x, 0, z).project(options.camera); top.set(x, H, z).project(options.camera); side.set(x + 1, H, z).project(options.camera);
      const slope = (side.x - top.x) * H; if (Math.abs(slope) > 1e-9) { meshes.setShear(tower.stacked.index, (base.x - top.x) / slope); tower.group.matrix.copy(meshes.rootMatrix(tower.stacked.index, rootM)); tower.group.matrixWorldNeedsUpdate = true; }
    }
  };
  /** Advance pops to sim-clock `seconds` (deterministic: no wall clock in render code). */
  const animate = (seconds: number) => { clock = seconds * 1000; return !disposed && meshes ? meshes.animate(clock) : false; };
  const resize = () => refreshShear();
  const dispose = () => { if (disposed) return; disposed = true; scope.dispose(); };
  scope.defer(() => { disposed = true; });
  window.addEventListener('resize', resize); scope.defer(() => window.removeEventListener('resize', resize));
  try { update(options.view); refreshShear(); } catch (error) { dispose(); throw error; }
  return { towers: towers as readonly TowerPresentation[], summary, update, animate, resize, dispose,
    /** World width (u) of a tower's visual (stacked build), or undefined. */
    visualWidth: (id: string): number | undefined => { const i = options.view.ids.towers.indexOf(id); return i < 0 ? undefined : towers[i]?.stacked?.width; } };
}
