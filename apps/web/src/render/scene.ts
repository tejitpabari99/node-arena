import { Color, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { ManifestV2 } from '@node-arena/content';
import type { SimEvent } from '@node-arena/defs';
import type { SimView } from '@node-arena/sim';
import { Disposables } from './disposables.js';
import { fitCamera, HUD_PADDING, levelVisualBounds, zoomFraming, type HudPadding } from './camera.js';
import { createMirroredWorldRoot } from './world-root.js';
import { createWorldRenderer, type WorldFrame, type WorldLevel, type WorldRendererOptions } from './world.js';

export interface SceneOptions {
  level: WorldLevel & { theme: string };
  view: SimView;
  manifest: ManifestV2;
  parent: HTMLElement;
  scope?: Disposables;
  padding?: HudPadding;
  zoomed?: boolean;
  /** Ground-only extent in sim milli-units (editor); omitted for the game. */
  groundExtent?: import('./ground-renderer.js').Bounds;
  worldOptions?: Omit<WorldRendererOptions, 'worldRoot'>;
}

/** Canvas/camera ownership only. SP07 owns every world object and its readable, unmirrored labels.
 * Await ready before the first update. Resize refits this same camera/canvas; it never loads a level.
 */
export function createLevelScene(options: SceneOptions) {
  const { level, view, manifest, parent } = options;
  const scope = options.scope ?? new Disposables();
  const scene = new Scene(), camera = new PerspectiveCamera();
  const theme = manifest.themes[level.theme];
  if (!theme) throw new Error(`Unknown theme: ${level.theme}`);
  scene.background = new Color(theme.sky);
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.domElement.style.display = 'block';
  parent.appendChild(renderer.domElement);
  const worldRoot = createMirroredWorldRoot(); scene.add(worldRoot);
  const world = createWorldRenderer(scene, manifest, { ...options.worldOptions, worldRoot });
  const ids = level.buildings.map(b => b.id);
  let bounds = levelVisualBounds(view,ids,world.anchors), disposed = false, zoomed = options.zoomed ?? false;
  const render = () => { if (!disposed) renderer.render(scene,camera); };
  const resize = () => {
    if (disposed) return;
    const width = Math.max(1,parent.clientWidth), height = Math.max(1,parent.clientHeight);
    renderer.setPixelRatio(Math.min(2,Math.max(1,window.devicePixelRatio || 1)));
    renderer.setSize(width,height);
    fitCamera(camera,bounds,manifest.camera,width/height,{width,height,padding: options.padding ?? HUD_PADDING},zoomFraming(zoomed));
    render();
  };
  const observer = new ResizeObserver(resize); observer.observe(parent);
  // DPR can change when moving between monitors without changing the host's CSS size.
  window.addEventListener('resize',resize);
  scope.defer(() => {
    disposed = true; observer.disconnect(); window.removeEventListener('resize',resize);
    world.dispose(); worldRoot.removeFromParent();
    renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  });
  resize();
  const ready = world.setLevel(level,level.theme,options.groundExtent).then(() => {
    if (disposed) return;
    bounds = levelVisualBounds(view,ids,world.anchors); resize();
  });
  return { scene,camera,worldRoot,world,renderer,canvas: renderer.domElement,ready,
    get bounds() { return bounds; },get zoomed() { return zoomed; },setZoom(next: boolean) { zoomed = next; resize(); },resize,render,
    update(frame: WorldFrame,events: readonly SimEvent[],dtMs: number) { if (!disposed) world.update(frame,events,dtMs); },
    dispose: () => scope.dispose(),
  };
}
