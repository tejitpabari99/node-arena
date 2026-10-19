import { Box3, CanvasTexture, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, Vector3, type Camera, type Color, type Material, type Object3D } from 'three';
import type { Manifest } from '@node-arena/content';
import type { SimView } from '@node-arena/sim';
import { createManifestResolver } from '../manifest/resolve.js';
import { Disposables } from './disposables.js';
import { cloneModel } from './model.js';
import { createLabelLayer, type TowerLabel } from './labels.js';
import { createOverlayRegistry, readOverlays, type OverlayRegistry } from './overlays.js';

type ColoredMaterial = Material & { color: Color };
function isColored(material: Material): material is ColoredMaterial { return 'color' in material; }
export interface TowerPresentation {
  readonly group: Group;
  readonly model: Object3D;
  readonly base: Mesh<CylinderGeometry, MeshStandardMaterial>;
  readonly baseMarker: Mesh<PlaneGeometry, MeshBasicMaterial>;
  readonly roofMarker: Mesh<PlaneGeometry, MeshBasicMaterial>;
  readonly label?: TowerLabel;
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
  const textures = new Map<string, CanvasTexture>(); let disposed = false, colorblind = options.colorblind ?? false;
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
  const labels = createLabelLayer(options.parent, scope);
  try {
    for (let i = 0; i < options.view.towerStatic.length; i++) {
      const tower = options.view.towerStatic[i]!, visual = resolver.visual(tower.visual, 'tower');
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
      group.userData = { visualRole: 'tower', towerIndex: i }; model.userData.visualPart = 'model'; roofMarker.userData.visualRole = 'count';
      group.add(baseMarker, roofMarker); options.scene.add(group); scope.defer(() => group.removeFromParent());
      const values = readOverlays(registry, tower.components, options.view, i);
      const label = values.length ? labels.add(i, new Vector3(group.position.x, Math.max(visual.label?.height ?? physical.max.y + .8, physical.max.y + .2), group.position.z), values.map(value => value.key)) : undefined;
      towers.push({ group, model, base, baseMarker, roofMarker, ...(label ? { label } : {}) }); teamMaterials.push(colors);
    }
  } catch (error) { scope.dispose(); throw error; }
  const update = (view: SimView, settings: { colorblind?: boolean } = {}) => {
    if (disposed) return;
    if (view.towerStatic.length !== towers.length) throw new Error('Create a new tower renderer when changing levels');
    colorblind = settings.colorblind ?? colorblind;
    for (let i = 0; i < towers.length; i++) {
      const tower = towers[i]!, owner = view.tower.owner[i]!, colorKey = owner < 0 ? 'neutral' : view.players[owner]!.colorKey;
      const color = resolver.color(colorKey, colorblind ? 'colorblind' : 'default'), glyph = resolver.marker(colorKey);
      const team = `${color}\0${glyph}`;
      if (previousTeams[i] !== team) {
        tower.base.material.color.set(color); for (const material of teamMaterials[i]!) material.color.set(color);
        for (const mesh of [tower.baseMarker, tower.roofMarker]) {
          const texture = markerTexture(glyph); if (mesh.material.map !== texture) { mesh.material.map = texture; mesh.material.needsUpdate = true; }
          mesh.userData.glyph = glyph;
        }
        previousTeams[i] = team; tower.group.userData.paintColor = color;
      }
      tower.label?.update(glyph, color, readOverlays(registry, view.towerStatic[i]!.components, view, i));
    }
  };
  const projectLabels = () => { if (!disposed) labels.project(options.camera); };
  const resize = projectLabels;
  const dispose = () => { if (disposed) return; disposed = true; scope.dispose(); };
  scope.defer(() => { disposed = true; });
  window.addEventListener('resize', resize); scope.defer(() => window.removeEventListener('resize', resize));
  try { update(options.view); projectLabels(); } catch (error) { dispose(); throw error; }
  return { towers: towers as readonly TowerPresentation[], labelLayer: labels.element, update, resize, projectLabels, dispose };
}
