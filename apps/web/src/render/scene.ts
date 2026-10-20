import { Box3, Color, DirectionalLight, Fog, HemisphereLight, Mesh, PCFShadowMap, PerspectiveCamera, Scene, Vector3, WebGLRenderer, type Object3D } from 'three';
import type { CompiledLevel, Manifest } from '@node-arena/content';
import { createManifestResolver } from '../manifest/resolve.js';
import { Disposables } from './disposables.js';
import { cloneModel } from './model.js';
import { cameraSettingsFor, fitCamera, levelVisualBounds } from './camera.js';
import { createGround } from './ground.js';
import { createProps, scatterProps } from './props.js';

const HEMI_INTENSITY = 1;
export type Quality = 'low' | 'med' | 'high';
export function qualitySettings(quality: Quality, dpr: number) {
  return { pixelRatio: quality === 'low' ? 1 : quality === 'med' ? 1.5 : Math.min(dpr, 2),
    shadowSize: quality === 'low' ? 0 : quality === 'med' ? 1024 : 2048, antialias: quality !== 'low' };
}
export interface SceneOptions {
  level: CompiledLevel;
  manifest: Manifest;
  /** Borrowed from a ready AssetSession; dispose that session after the render scope. */
  models: ReadonlyMap<string, Object3D>;
  parent: HTMLElement;
  scope: Disposables;
  quality?: Quality;
  /** Antialias changes replace the context/canvas. Input owners must rebind here. */
  onCanvasChange?: (canvas: HTMLCanvasElement, previous: HTMLCanvasElement) => void;
}

export function createLevelScene(options: SceneOptions) {
  const { level, manifest, models, parent, scope } = options;
  const scene = new Scene(), camera = new PerspectiveCamera();
  const theme = createManifestResolver(manifest).theme(level.visual);
  scene.background = new Color(theme.sky);
  if (theme.fog) scene.fog = new Fog(theme.fog.color, theme.fog.near, theme.fog.far);
  const bounds = levelVisualBounds(level, manifest, models);
  const { ground } = createGround({ scene, scope, theme, bounds });
  // Border dressing (seeded per level id); tower footprints from the compiled level (milli-units -> world).
  const props = theme.scatter ? createProps({ scene, scope, theme, models, placements: scatterProps(level.id,
    { minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z },
    level.towers.map(t => ({ x: t.x / 1000, z: t.y / 1000, radius: t.footprintRadius / 1000 })), theme.scatter) }) : undefined;
  for (const prop of theme.props ?? []) {
    const model = models.get(prop.model); if (!model) throw new Error(`Missing loaded model: ${prop.model}`);
    const clone = cloneModel(model, scope); clone.position.fromArray(prop.pos); clone.scale.setScalar(prop.scale ?? 1);
    if (prop.rotation) clone.rotation.set(prop.rotation[0]!, prop.rotation[1]!, prop.rotation[2]!);
    clone.traverse(node => { if (node instanceof Mesh) { node.castShadow = true; node.receiveShadow = true; } });
    clone.userData.visualRole = 'ground'; // probe tag only: border props count as ground
    scene.add(clone); bounds.union(new Box3().setFromObject(clone));
  }
  const light = new DirectionalLight(theme.light.color, theme.light.intensity);
  const center = bounds.getCenter(new Vector3()), size = bounds.getSize(new Vector3());
  const radius = Math.max(size.length(), 1), direction = new Vector3().fromArray(theme.light.dir);
  // A zero authored vector has a deterministic overhead fallback.
  if (direction.lengthSq() === 0) direction.set(0, 1, 0);
  // One warm key light plus a sky/sand hemisphere fill.
  const fill = new HemisphereLight(theme.palette?.sand ?? theme.sky, theme.palette?.sandShade ?? theme.ground, HEMI_INTENSITY); scene.add(fill);
  scope.defer(() => { fill.dispose(); fill.removeFromParent(); });
  light.position.copy(center).addScaledVector(direction.normalize(), radius * 2); light.target.position.copy(center);
  Object.assign(light.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: .01, far: radius * 4 });
  light.shadow.camera.updateProjectionMatrix(); scene.add(light, light.target);
  scope.defer(() => { light.dispose(); light.removeFromParent(); light.target.removeFromParent(); });
  let quality = options.quality ?? 'high', disposed = false;
  const makeRenderer = () => {
    const renderer = new WebGLRenderer({ antialias: qualitySettings(quality, window.devicePixelRatio).antialias });
    renderer.domElement.style.display = 'block'; return renderer;
  };
  let renderer = makeRenderer(); parent.appendChild(renderer.domElement);
  // Manifest fog distances are tuned for the landscape framing (camera about FOG_REFERENCE units from the arena centre);
  // narrower aspects pull the camera back, so scale the fog out with it instead of swallowing the arena.
  const FOG_REFERENCE = 160, fogCenter = bounds.getCenter(new Vector3());
  const resize = () => {
    if (disposed) return;
    const width = Math.max(1, parent.clientWidth), height = Math.max(1, parent.clientHeight);
    renderer.setPixelRatio(qualitySettings(quality, window.devicePixelRatio).pixelRatio); renderer.setSize(width, height);
    fitCamera(camera, bounds, cameraSettingsFor(level.id, manifest.camera), width / height);
    if (scene.fog instanceof Fog && theme.fog) {
      const scale = Math.max(1, camera.position.distanceTo(fogCenter) / FOG_REFERENCE);
      scene.fog.near = theme.fog.near * scale; scene.fog.far = theme.fog.far * scale;
    }
  };
  const applyQuality = () => {
    const settings = qualitySettings(quality, window.devicePixelRatio);
    renderer.shadowMap.enabled = settings.shadowSize > 0; renderer.shadowMap.type = PCFShadowMap;
    light.castShadow = settings.shadowSize > 0; props?.setShadows(settings.shadowSize > 0);
    light.shadow.map?.dispose(); light.shadow.map = null;
    light.shadow.mapPass?.dispose(); light.shadow.mapPass = null;
    light.shadow.mapSize.set(settings.shadowSize || 1, settings.shadowSize || 1); light.shadow.needsUpdate = true;
    // Bias in world units (about 1.5 shadow texels) so the larger high-quality map self-shadows buildings no more than medium.
    light.shadow.bias = -0.0005; light.shadow.normalBias = settings.shadowSize ? 1.5 * 2 * radius / settings.shadowSize : 0;
    light.shadow.intensity = 0.8;
    resize();
  };
  const setQuality = (next: Quality) => {
    if (disposed || next === quality) return;
    const replace = qualitySettings(next, 1).antialias !== qualitySettings(quality, 1).antialias;
    const previous = renderer, previousQuality = quality; quality = next;
    if (replace) {
      // Create first so a context failure leaves the existing canvas available.
      try { renderer = makeRenderer(); } catch (error) { quality = previousQuality; throw error; }
      previous.domElement.replaceWith(renderer.domElement); previous.dispose(); previous.forceContextLoss();
    }
    applyQuality();
    if (replace) options.onCanvasChange?.(renderer.domElement, previous.domElement);
  };
  const dispose = () => { if (disposed) return; disposed = true; scope.dispose(); };
  window.addEventListener('resize', resize);
  scope.defer(() => { disposed = true; window.removeEventListener('resize', resize); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); });
  applyQuality();
  return { scene, camera, ground, light, bounds, get renderer() { return renderer; }, get canvas() { return renderer.domElement; },
    get quality() { return quality; }, resize, render: () => { if (!disposed) renderer.render(scene, camera); }, setQuality, dispose };
}
