import { compileLevel, computeRequires, loadCatalog, loadLevel, type Catalog, type CompiledLevel, type ManifestV2 } from '@node-arena/content';
import { create, createTroopBuffer, type Sim } from '@node-arena/sim';
import { Raycaster, TextureLoader, Vector2, Vector3 } from 'three';
import { contentFiles } from '../app/boot.js';
import { loadManifest } from '../manifest/load.js';
import { fitCamera, HUD_PADDING, levelVisualBounds, zoomFraming } from '../render/camera.js';
import { createLevelScene } from '../render/scene.js';
import type { LevelDoc } from './document.js';
import { groundAt, pickObstacle, type Point, type Selection } from './picking.js';

export interface ViewportStatus { message: string; rebuildMs?: number; compileMs?: number; sceneMs?: number; firstFrameMs?: number }
/** Editor owns camera/gestures only. Later reducer and ghost tools consume this working-copy seam. */
export function createEditorViewport(parent: HTMLElement, callbacks: {
  selection?(items: Selection[]): void;
  status?(status: ViewportStatus): void;
  pointer?(point: Point | null): void;
} = {}) {
  let scene: ReturnType<typeof createLevelScene> | undefined;
  let level: CompiledLevel | undefined, sim: Sim | undefined;
  let disposed = false, generation = 0, zoom = 1, pan = { x: 0, z: 0 };
  let selection: Selection[] = [];
  let resources: Promise<{ manifest: ManifestV2; catalog: Catalog }> | undefined;
  let pending = Promise.resolve();
  const marquee = document.createElement('div'); marquee.className = 'editor-marquee'; marquee.hidden = true; parent.append(marquee);
  let gesture: { id: number; x: number; y: number; lastX: number; lastY: number; pan: boolean; empty: boolean } | undefined;
  const report = (status: ViewportStatus) => callbacks.status?.(status);
  function frameCamera() {
    if (!scene || !level || !sim || !manifest) return;
    const width = Math.max(1, parent.clientWidth), height = Math.max(1, parent.clientHeight);
    scene.camera.zoom = zoom;
    fitCamera(scene.camera, levelVisualBounds(sim.view, level.buildings.map(b => b.id), scene.world.anchors), manifest.camera,
      width / height, { width, height, padding: HUD_PADDING }, zoomFraming(false));
    scene.camera.position.x += pan.x; scene.camera.position.z += pan.z;
    scene.camera.updateMatrixWorld(); scene.render();
  }
  let manifest: ManifestV2 | undefined;
  // The shared scene refits first; defer our editor camera until after its resize observer.
  let renderFrame = 0;
  function scheduleFrame() {
    if (disposed || renderFrame) return;
    renderFrame = requestAnimationFrame(() => { renderFrame = 0; if (!disposed) frameCamera(); });
  }
  const textureLoader = new TextureLoader();
  const loadTexture = (path: string) => textureLoader.load(`/${path}`, scheduleFrame);
  const observer = new ResizeObserver(scheduleFrame); observer.observe(parent);
  function choose(items: Selection[]) {
    selection = items;
    scene?.world.select(items[0]?.kind === 'building' ? level?.buildings.findIndex(b => b.id === items[0]!.id) ?? null : null);
    scene?.render(); callbacks.selection?.(items);
  }
  function at(x: number, y: number) {
    return scene ? groundAt(x, y, scene.canvas.getBoundingClientRect(), scene.camera, scene.worldRoot) : null;
  }
  function pick(x: number, y: number): Selection | null {
    if (!scene || !level) return null;
    const rect = scene.canvas.getBoundingClientRect(), ray = new Raycaster();
    scene.scene.updateMatrixWorld(true);
    ray.setFromCamera(new Vector2((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2), scene.camera);
    for (const hit of ray.intersectObjects(scene.world.pickMeshes, false)) {
      const index = hit.object.userData.buildingIndex as number | undefined;
      if (index !== undefined && level.buildings[index]) return { kind: 'building', id: level.buildings[index]!.id };
    }
    const point = at(x, y), id = point && pickObstacle(point, level.elements);
    return id ? { kind: 'obstacle', id } : null;
  }
  function screenPoint(x: number, z: number) {
    if (!scene) return null;
    const rect = scene.canvas.getBoundingClientRect();
    const v = new Vector3(x, 0, z).applyMatrix4(scene.worldRoot.matrixWorld).project(scene.camera);
    return { x: rect.left + (v.x + 1) * rect.width / 2, y: rect.top + (1 - v.y) * rect.height / 2 };
  }
  function cancel() { gesture = undefined; marquee.hidden = true; }
  function down(event: PointerEvent) {
    if (!scene || gesture || !event.isPrimary || ![0, 1, 2].includes(event.button)) return;
    const panning = event.button !== 0 || event.altKey;
    const hit = panning ? null : pick(event.clientX, event.clientY);
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, pan: panning, empty: hit === null };
    if (!panning) choose(hit ? [hit] : []);
    scene.canvas.setPointerCapture(event.pointerId); event.preventDefault();
  }
  function move(event: PointerEvent) {
    callbacks.pointer?.(at(event.clientX, event.clientY));
    if (!gesture || gesture.id !== event.pointerId || !scene) return;
    if (gesture.pan) {
      const a = at(gesture.lastX, gesture.lastY), b = at(event.clientX, event.clientY);
      if (a && b) { pan.x += a.x - b.x; pan.z -= a.z - b.z; frameCamera(); }
    } else if (gesture.empty && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5) {
      const rect = parent.getBoundingClientRect(); marquee.hidden = false;
      Object.assign(marquee.style, { left: `${Math.min(gesture.x, event.clientX) - rect.left}px`, top: `${Math.min(gesture.y, event.clientY) - rect.top}px`, width: `${Math.abs(event.clientX - gesture.x)}px`, height: `${Math.abs(event.clientY - gesture.y)}px` });
    }
    gesture.lastX = event.clientX; gesture.lastY = event.clientY;
  }
  function up(event: PointerEvent) {
    if (!gesture || gesture.id !== event.pointerId) return;
    if (!gesture.pan && !marquee.hidden && level) {
      const left = Math.min(gesture.x, event.clientX), right = Math.max(gesture.x, event.clientX);
      const top = Math.min(gesture.y, event.clientY), bottom = Math.max(gesture.y, event.clientY);
      const items: Selection[] = [];
      for (const [kind, entries] of [['building', level.buildings], ['obstacle', level.elements]] as const) {
        for (const item of entries) {
          const p = screenPoint(item.x / 1000, item.z / 1000);
          if (p && p.x >= left && p.x <= right && p.y >= top && p.y <= bottom) items.push({ kind, id: item.id });
        }
      }
      choose(items);
    }
    cancel();
    if (scene?.canvas.hasPointerCapture(event.pointerId)) scene.canvas.releasePointerCapture(event.pointerId);
  }
  function wheel(event: WheelEvent) { if (!scene) return; event.preventDefault(); zoomBy(Math.exp(-event.deltaY * .001)); }
  function context(event: Event) { event.preventDefault(); }
  const handlers = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: cancel, lostpointercapture: cancel, wheel, contextmenu: context };
  for (const [name, handler] of Object.entries(handlers)) parent.addEventListener(name, handler as EventListener, { passive: false });
  function zoomBy(factor: number) { zoom = Math.min(3, Math.max(.35, zoom * factor)); frameCamera(); }
  function gameCamera() { zoom = 1; pan = { x: 0, z: 0 }; frameCamera(); }
  function clearScene() { scene?.dispose(); scene = undefined; level = undefined; sim = undefined; }
  async function rebuild(doc: LevelDoc, token: number) {
    if (disposed || token !== generation) return;
    cancel(); choose([]);
    if (!doc.buildings.length) { clearScene(); report({ message: 'Add a building to preview this blank level.' }); return; }
    report({ message: 'Loading preview…' });
    try {
      resources ??= loadManifest().then(value => ({ manifest: value, catalog: loadCatalog(contentFiles(), { themes: Object.keys(value.themes), colorKeys: Object.keys(value.palettes) }) }));
      const loaded = await resources;
      if (disposed || token !== generation) return;
      manifest = loaded.manifest;
      const start = performance.now();
      // requires is derived; don't mutate the editable document merely to preview it.
      const parsed = loadLevel(loaded.catalog, { ...doc, requires: computeRequires(loaded.catalog, doc) });
      const next = compileLevel(loaded.catalog, parsed.level), nextSim = create(next, 1);
      const compiledAt = performance.now();
      if (scene && level?.theme !== next.theme) clearScene();
      if (!scene) {
        scene = createLevelScene({ level: next, view: nextSim.view, manifest, parent, worldOptions: { textureLoader: loadTexture } });
        await scene.ready;
      } else await scene.world.setLevel(next, next.theme);
      if (disposed || token !== generation) return;
      const sceneAt = performance.now();
      level = next; sim = nextSim;
      scene.update({ view: sim.view, troops: createTroopBuffer(0), n: 0, alpha: 0, towerRadiusMilli: sim.towerRadiusMilli.bind(sim) }, [], 0);
      const rebuiltAt = performance.now();
      frameCamera();
      report({ message: 'Ready', rebuildMs: rebuiltAt - start, compileMs: compiledAt - start, sceneMs: sceneAt - compiledAt, firstFrameMs: performance.now() - start });
    } catch (error) {
      if (disposed || token !== generation) return;
      clearScene(); report({ message: `Preview unavailable: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return {
    /** Serializes asset rebuilds; superseded requests are skipped, and no stale result enables picking. */
    setDocument(doc: LevelDoc) { const token = ++generation; pending = pending.then(() => rebuild(doc, token)); return pending; },
    zoomBy, gameCamera, pick, groundAt: at,
    get inspection() { return scene; },
    get previewSim() { return sim; },
    get selected() { return selection; },
    dispose() {
      disposed = true; generation++; cancel(); observer.disconnect(); cancelAnimationFrame(renderFrame);
      for (const [name, handler] of Object.entries(handlers)) parent.removeEventListener(name, handler as EventListener);
      clearScene(); marquee.remove();
    },
  };
}
export type EditorViewport = ReturnType<typeof createEditorViewport>;
