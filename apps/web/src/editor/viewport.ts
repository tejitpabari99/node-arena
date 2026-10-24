import { compileLevel, computeRequires, loadCatalog, loadLevel, type Catalog, type CompiledLevel, type ManifestV2 } from '@node-arena/content';
import { create, createTroopBuffer, type Sim } from '@node-arena/sim';
import { Object3D, PerspectiveCamera, Raycaster, TextureLoader, Vector2, Vector3 } from 'three';
import { contentFiles } from '../app/boot.js';
import { loadManifest } from '../manifest/load.js';
import { fitCamera, HUD_PADDING, levelVisualBounds, zoomFraming } from '../render/camera.js';
import { createLevelScene } from '../render/scene.js';
import type { DocOp, LibraryItem } from './model.js';
import type { LevelDoc } from './document.js';
import { groundAt, pickObstacle, type Point, type Selection } from './picking.js';

export interface ViewportStatus { message: string; rebuildMs?: number; compileMs?: number; sceneMs?: number; firstFrameMs?: number }
/** Editor camera, picking and transient drag previews; only release emits document edits. */
export function createEditorViewport(parent: HTMLElement, callbacks: {
  selection?(items: Selection[]): void;
  status?(status: ViewportStatus): void;
  pointer?(point: Point | null): void;
  edit?(op: DocOp): void;
} = {}) {
  let scene: ReturnType<typeof createLevelScene> | undefined;
  let level: CompiledLevel | undefined, sim: Sim | undefined;
  let disposed = false, generation = 0, zoom = 1, pan = { x: 0, z: 0 };
  let selection: Selection[] = [];
  let workingDoc: LevelDoc | undefined;
  const blankCamera = new PerspectiveCamera(45, 1, .1, 1000), blankRoot = new Object3D();
  const ghost = document.createElement('div'); ghost.className = 'editor-ghost'; ghost.hidden = true; parent.append(ghost);
  let placement: { item: LibraryItem; id: number } | undefined;
  let ghostPoint: Point | null = null;
  function showGhost(point: Point | null, label: string) {
    ghostPoint = point; ghost.hidden = !point;
    if (!point) return;
    const p = screenPoint(point.x, point.z), rect = parent.getBoundingClientRect();
    if (!p) { ghost.hidden = true; return; }
    Object.assign(ghost.style, { left: `${p.x - rect.left}px`, top: `${p.y - rect.top}px` });
    ghost.textContent = label; ghost.dataset.x = String(point.x); ghost.dataset.z = String(point.z);
  }
  function inside(x: number, y: number) {
    const r = parent.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
  let resources: Promise<{ manifest: ManifestV2; catalog: Catalog }> | undefined;
  let pending = Promise.resolve();
  const marquee = document.createElement('div'); marquee.className = 'editor-marquee'; marquee.hidden = true; parent.append(marquee);
  let gesture: { id: number; x: number; y: number; lastX: number; lastY: number; pan: boolean; empty: boolean; target: Selection | null; origin: Point | null; start: Point | null } | undefined;
  const report = (status: ViewportStatus) => callbacks.status?.(status);
  function frameCamera() {
    if (!scene || !level || !sim || !manifest) {
      if (!workingDoc) return;
      const b = workingDoc.bounds, width = Math.max(1, parent.clientWidth), height = Math.max(1, parent.clientHeight);
      blankCamera.aspect = width / height;
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      const distance = Math.max(b.maxZ - b.minZ, (b.maxX - b.minX) / blankCamera.aspect) * 1.5;
      blankCamera.position.set(cx, distance, cz + distance * .5); blankCamera.lookAt(cx, 0, cz);
      blankCamera.updateProjectionMatrix(); blankCamera.updateMatrixWorld(); return;
    }
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
    const index = items[0]?.kind === 'building' ? level?.buildings.findIndex(b => b.id === items[0]!.id) : undefined;
    scene?.world.select(index !== undefined && index >= 0 ? index : null);
    scene?.render(); callbacks.selection?.(items);
  }
  function at(x: number, y: number) {
    return groundAt(x, y, scene?.canvas.getBoundingClientRect() ?? parent.getBoundingClientRect(), scene?.camera ?? blankCamera, scene?.worldRoot ?? blankRoot);
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
    const rect = scene?.canvas.getBoundingClientRect() ?? parent.getBoundingClientRect();
    const v = new Vector3(x, 0, z).applyMatrix4((scene?.worldRoot ?? blankRoot).matrixWorld).project(scene?.camera ?? blankCamera);
    return { x: rect.left + (v.x + 1) * rect.width / 2, y: rect.top + (1 - v.y) * rect.height / 2 };
  }
  function cancel() { gesture = undefined; placement = undefined; ghostPoint = null; ghost.hidden = true; marquee.hidden = true; }
  function down(event: PointerEvent) {
    if (!scene || gesture || !event.isPrimary || ![0, 1, 2].includes(event.button)) return;
    const panning = event.button !== 0 || event.altKey;
    const hit = panning ? null : pick(event.clientX, event.clientY);
    const item = hit && (hit.kind === 'building' ? workingDoc?.buildings : workingDoc?.elements)?.find(item => item.id === hit.id);
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, pan: panning, empty: hit === null, target: hit, origin: item ? { ...item.pos } : null, start: at(event.clientX, event.clientY) };
    if (!panning) choose(hit ? [hit] : []);
    scene.canvas.setPointerCapture(event.pointerId); event.preventDefault();
  }
  function move(event: PointerEvent) {
    callbacks.pointer?.(at(event.clientX, event.clientY));
    if (!gesture || gesture.id !== event.pointerId || !scene) return;
    if (gesture.pan) {
      const a = at(gesture.lastX, gesture.lastY), b = at(event.clientX, event.clientY);
      if (a && b) { pan.x += a.x - b.x; pan.z -= a.z - b.z; frameCamera(); }
    } else if (gesture.target && gesture.origin && gesture.start) {
      const p = Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5 ? at(event.clientX, event.clientY) : null;
      showGhost(p ? { x: Math.round((gesture.origin.x + p.x - gesture.start.x) * 100) / 100, z: Math.round((gesture.origin.z + p.z - gesture.start.z) * 100) / 100 } : null, gesture.target.id);
    } else if (gesture.empty && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5) {
      const rect = parent.getBoundingClientRect(); marquee.hidden = false;
      Object.assign(marquee.style, { left: `${Math.min(gesture.x, event.clientX) - rect.left}px`, top: `${Math.min(gesture.y, event.clientY) - rect.top}px`, width: `${Math.abs(event.clientX - gesture.x)}px`, height: `${Math.abs(event.clientY - gesture.y)}px` });
    }
    gesture.lastX = event.clientX; gesture.lastY = event.clientY;
  }
  function up(event: PointerEvent) {
    if (!gesture || gesture.id !== event.pointerId) return;
    if (!gesture.pan && gesture.target && ghostPoint && inside(event.clientX, event.clientY)) {
      callbacks.edit?.({ type: 'move', target: gesture.target, pos: ghostPoint });
    }
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
  function dragMove(event: PointerEvent) {
    if (!placement || event.pointerId !== placement.id) return;
    const point = inside(event.clientX, event.clientY) ? at(event.clientX, event.clientY) : null;
    callbacks.pointer?.(point); showGhost(point, placement.item);
  }
  function dragUp(event: PointerEvent) {
    if (!placement || event.pointerId !== placement.id) return;
    const item = placement.item, pos = inside(event.clientX, event.clientY) ? at(event.clientX, event.clientY) : null;
    cancel();
    if (pos) callbacks.edit?.({ type: 'place', item, pos });
  }
  window.addEventListener('pointermove', dragMove); window.addEventListener('pointerup', dragUp); window.addEventListener('pointercancel', cancel);
  function wheel(event: WheelEvent) { if (!scene) return; event.preventDefault(); zoomBy(Math.exp(-event.deltaY * .001)); }
  function context(event: Event) { event.preventDefault(); }
  const handlers = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: cancel, lostpointercapture: cancel, wheel, contextmenu: context };
  for (const [name, handler] of Object.entries(handlers)) parent.addEventListener(name, handler as EventListener, { passive: false });
  function zoomBy(factor: number) { zoom = Math.min(3, Math.max(.35, zoom * factor)); frameCamera(); }
  function gameCamera() { zoom = 1; pan = { x: 0, z: 0 }; frameCamera(); }
  function clearScene() { scene?.dispose(); scene = undefined; level = undefined; sim = undefined; }
  async function rebuild(doc: LevelDoc, token: number) {
    if (disposed || token !== generation) return;
    cancel();
    const priorSelection = workingDoc?.id === doc.id ? selection : [];
    const nextSelection = priorSelection.filter(item => (item.kind === 'building' ? doc.buildings : doc.elements).some(entry => entry.id === item.id));
    // A newly placed item becomes the current selection after its rebuild.
    if (workingDoc?.id === doc.id && !nextSelection.length) {
      const previous = new Set([...(workingDoc?.buildings ?? []), ...(workingDoc?.elements ?? [])].map(item => item.id));
      const added = [...doc.buildings.map(item => ({ kind: 'building' as const, id: item.id })), ...doc.elements.map(item => ({ kind: 'obstacle' as const, id: item.id }))].filter(item => !previous.has(item.id));
      if (added.length === 1) nextSelection.push(added[0]!);
    }
    workingDoc = doc;
    choose(nextSelection);
    if (!doc.buildings.length) { clearScene(); frameCamera(); report({ message: 'Add a building to preview this blank level.' }); return; }
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
      frameCamera(); choose(nextSelection);
      report({ message: 'Ready', rebuildMs: rebuiltAt - start, compileMs: compiledAt - start, sceneMs: sceneAt - compiledAt, firstFrameMs: performance.now() - start });
    } catch (error) {
      if (disposed || token !== generation) return;
      clearScene(); frameCamera(); report({ message: `Preview unavailable: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return {
    /** Serializes asset rebuilds; superseded requests are skipped, and no stale result enables picking. */
    setDocument(doc: LevelDoc) { const token = ++generation; pending = pending.then(() => rebuild(doc, token)); return pending; },
    beginPlacement(item: LibraryItem, pointerId: number) { cancel(); placement = { item, id: pointerId }; },
    zoomBy, gameCamera, pick, groundAt: at,
    get inspection() { return scene; },
    get previewSim() { return sim; },
    get selected() { return selection; },
    dispose() {
      disposed = true; generation++; cancel(); observer.disconnect(); cancelAnimationFrame(renderFrame);
      for (const [name, handler] of Object.entries(handlers)) parent.removeEventListener(name, handler as EventListener);
      window.removeEventListener('pointermove', dragMove); window.removeEventListener('pointerup', dragUp); window.removeEventListener('pointercancel', cancel);
      clearScene(); marquee.remove(); ghost.remove();
    },
  };
}
export type EditorViewport = ReturnType<typeof createEditorViewport>;
