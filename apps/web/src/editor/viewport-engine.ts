import { compileLevel, computeRequires, loadCatalog, loadLevel, type Catalog, type CompiledLevel, type ManifestV2 } from '@node-arena/content';
import { create, createTroopBuffer, type Sim } from '@node-arena/sim';
import { Box3, Object3D, PerspectiveCamera, Raycaster, TextureLoader, Vector2, Vector3 } from 'three';
import { contentFiles } from '../app/boot.js';
import { loadManifest } from '../manifest/load.js';
import { fitCamera, HUD_PADDING, levelVisualBounds, paddingFractions, zoomFraming } from '../render/camera.js';
import { createLevelScene } from '../render/scene.js';
import { buildableArea, clampPoint, snapPosition, type Area, type DocOp, type LibraryItem } from './model.js';
import type { LevelDoc } from './document.js';
import { groundAt, pickObstacle, type Point, type Selection } from './picking.js';

export interface ViewState { zoom: number; min: number; max: number; atMin: boolean; atMax: boolean }
export const ZOOM_MAX = 4;
/** Largest campaign bounds; the frame box never gets smaller than this around the area centre. */
const FRAME_FLOOR_W = 21, FRAME_FLOOR_H = 15;
export interface ViewportStatus { message: string; error?: string; rebuildMs?: number; compileMs?: number; sceneMs?: number; firstFrameMs?: number }
/** Editor camera, picking and transient drag previews; only release emits document edits. */
export function createEditorViewport(parent: HTMLElement, callbacks: {
  selection?(items: Selection[]): void;
  status?(status: ViewportStatus): void;
  pointer?(point: Point | null): void;
  edit?(op: DocOp): void;
  los?(message: string): void;
  view?(view: ViewState): void;
} = {}) {
  let scene: ReturnType<typeof createLevelScene> | undefined;
  let level: CompiledLevel | undefined, sim: Sim | undefined;
  let disposed = false, generation = 0, zoom = 1, pan = { x: 0, z: 0 };
  let area: Area | undefined, frameBox: Box3 | undefined, frameDocId: string | undefined;
  let intent: 'reset' | 'fit' | undefined = 'reset';
  let viewState: ViewState = { zoom: 1, min: 1, max: ZOOM_MAX, atMin: false, atMax: false };
  let selection: Selection[] = [];
  let hand = false, space = false, grid = false;
  let los: { from: string; to: string } | undefined;
  const svgNS = 'http://www.w3.org/2000/svg';
  const overlay = document.createElementNS(svgNS, 'svg'); overlay.classList.add('editor-layout-overlay'); parent.append(overlay);
  const groupGhosts: HTMLDivElement[] = [];
  function overlays() {
    overlay.replaceChildren();
    if (!workingDoc) return;
    const rect = parent.getBoundingClientRect();
    const point = (x: number, z: number) => { const p = screenPoint(x, z); return { x: p.x - rect.left, y: p.y - rect.top }; };
    const element = (tag: string, attributes: Record<string, string | number>, container: Element = overlay) => {
      const node = document.createElementNS(svgNS, tag);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
      container.append(node); return node;
    };
    const b = workingDoc.bounds, buildArea = currentArea();
    parent.dataset.bounds = JSON.stringify(b); parent.dataset.area = JSON.stringify(buildArea);
    const ring = (r: Area) => [[r.minX, r.minZ], [r.maxX, r.minZ], [r.maxX, r.maxZ], [r.minX, r.maxZ]].map(([x, z]) => { const p = point(x!, z!); return `${p.x},${p.y}`; });
    const w = rect.width, h = rect.height, corners = ring(buildArea);
    element('path', { d: `M0,0H${w}V${h}H0Z M${corners.join(' L')}Z`, 'fill-rule': 'evenodd', class: 'editor-area-shade' });
    element('polygon', { points: corners.join(' '), class: 'editor-area' });
    if (grid) {
      const mid = { x: Math.round((buildArea.minX + buildArea.maxX) / 2), z: Math.round((buildArea.minZ + buildArea.maxZ) / 2) };
      const o = point(mid.x, mid.z), px = point(mid.x + 1, mid.z), pz = point(mid.x, mid.z + 1);
      if (Math.min(Math.hypot(px.x - o.x, px.y - o.y), Math.hypot(pz.x - o.x, pz.y - o.y)) >= 8) {
        const lines = element('g', { class: 'editor-grid' });
        const line = (a: [number, number], c: [number, number], major: boolean) => {
          const s0 = point(a[0], a[1]), s1 = point(c[0], c[1]);
          element('line', { x1: s0.x, y1: s0.y, x2: s1.x, y2: s1.y, class: major ? 'editor-grid-line editor-grid-major' : 'editor-grid-line' }, lines);
        };
        for (let x = Math.ceil(buildArea.minX); x <= buildArea.maxX; x++) line([x, buildArea.minZ], [x, buildArea.maxZ], x % 5 === 0);
        for (let z = Math.ceil(buildArea.minZ); z <= buildArea.maxZ; z++) line([buildArea.minX, z], [buildArea.maxX, z], z % 5 === 0);
      }
    }
    for (const target of selection) {
      const item = (target.kind === 'building' ? workingDoc.buildings : workingDoc.elements).find(item => item.id === target.id);
      if (item) { const p = point(item.pos.x, item.pos.z); element('ellipse', { cx: p.x, cy: p.y, rx: 23, ry: 13, class: 'editor-selection-ring' }); }
    }
    if (!los?.from || !los.to) { callbacks.los?.('Choose two buildings to preview line of sight.'); return; }
    if (!sim || !level) { callbacks.los?.('Line of sight unavailable until preview is ready.'); return; }
    const from = level.buildings.findIndex(item => item.id === los!.from), to = level.buildings.findIndex(item => item.id === los!.to);
    if (from < 0 || to < 0) { callbacks.los?.('Choose two existing buildings.'); return; }
    const player = Math.max(0, workingDoc.players.findIndex(p => p.id === workingDoc!.buildings.find(item => item.id === los!.from)?.owner));
    const reason = sim.canDraw(player, from, to), explanation = sim.explainDraw(player, from, to);
    callbacks.los?.(reason ? `${reason}${explanation ? ` · ${explanation.ref}` : ''}` : 'Clear: route can be drawn');
    const a = level.buildings[from]!, bld = level.buildings[to]!;
    const aScreen = point(a.x / 1000, a.z / 1000), bScreen = point(bld.x / 1000, bld.z / 1000);
    const group = element('g', { class: 'editor-los' });
    element('line', { x1: aScreen.x, y1: aScreen.y, x2: bScreen.x, y2: bScreen.y, stroke: reason ? '#fb7185' : '#86efac', 'stroke-width': 3 }, group);
    if (explanation) { const p = point(explanation.point.x / 1000, explanation.point.z / 1000); element('circle', { cx: p.x, cy: p.y, r: 6, fill: '#fb7185' }, group); }
  }
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
  /** True while the last rebuild failed and the previous scene/level/sim is still shown. */
  let stale = false;
  const marquee = document.createElement('div'); marquee.className = 'editor-marquee'; marquee.hidden = true; parent.append(marquee);
  let gesture: { id: number; x: number; y: number; lastX: number; lastY: number; pan: boolean; empty: boolean; target: Selection | null; origin: Point | null; start: Point | null; targets: Selection[] } | undefined;
  const report = (status: ViewportStatus) => callbacks.status?.(status);
  const currentArea = (): Area => area ?? buildableArea(workingDoc!.bounds);
  /** Cached frame box (scene frame, z negated): visual bounds union a 21x15 floor box at the area centre. */
  function computeFrameBox(): Box3 {
    const a = currentArea(), cx = (a.minX + a.maxX) / 2, cz = -(a.minZ + a.maxZ) / 2;
    const box = levelVisualBounds(sim!.view, level!.buildings.map(b => b.id), scene!.world.anchors);
    return box.union(new Box3(new Vector3(cx - FRAME_FLOOR_W / 2, 0, cz - FRAME_FLOOR_H / 2), new Vector3(cx + FRAME_FLOOR_W / 2, 0, cz + FRAME_FLOOR_H / 2)));
  }
  /** Area +-12 in sim milli-units, so the ground covers the whole buildable area at Fit area. */
  const groundExtent = () => { const a = currentArea(); return { minX: (a.minX - 12) * 1000, maxX: (a.maxX + 12) * 1000, minZ: (a.minZ - 12) * 1000, maxZ: (a.maxZ + 12) * 1000 }; };
  const isLive = () => !!(scene && level && sim && manifest);
  const centreRay = new Raycaster();
  function frameCamera() {
    const live = isLive();
    if (!live && !workingDoc) return;
    const cam = live ? scene!.camera : blankCamera, zs = live ? -1 : 1;
    const width = Math.max(1, parent.clientWidth), height = Math.max(1, parent.clientHeight), a = currentArea();
    const ac = { x: (a.minX + a.maxX) / 2, z: zs * (a.minZ + a.maxZ) / 2 };
    const zLo = zs < 0 ? -a.maxZ : a.minZ, zHi = zs < 0 ? -a.minZ : a.maxZ;
    cam.zoom = 1;
    let fx = 1, fy = 1;
    if (live) {
      frameBox ??= computeFrameBox();
      fitCamera(cam, frameBox, manifest!.camera, width / height, { width, height, padding: HUD_PADDING }, zoomFraming(false));
      ({ fractionX: fx, fractionY: fy } = paddingFractions({ width, height, padding: HUD_PADDING }));
    } else {
      blankCamera.aspect = width / height;
      const distance = Math.max(FRAME_FLOOR_H, FRAME_FLOOR_W / blankCamera.aspect) * 1.5;
      blankCamera.position.set(ac.x, distance, ac.z + distance * .5); blankCamera.lookAt(ac.x, 0, ac.z);
      blankCamera.updateProjectionMatrix(); blankCamera.updateMatrixWorld(true);
    }
    // Ground point under the view centre at pan 0; pan translates the camera, so centre ground = g0 + pan.
    const base = cam.position.clone();
    centreRay.setFromCamera(new Vector2(0, 0), cam);
    const o = centreRay.ray.origin, d = centreRay.ray.direction, t = d.y === 0 ? 0 : -o.y / d.y;
    const g0 = { x: o.x + d.x * t, z: o.z + d.z * t }, centrePan = { x: ac.x - g0.x, z: ac.z - g0.z };
    cam.position.set(base.x + centrePan.x, base.y, base.z + centrePan.z); cam.updateMatrixWorld(true);
    let k = 0;
    for (const x of [a.minX, a.maxX]) for (const z of [zLo, zHi]) {
      const v = new Vector3(x, 0, z).project(cam); k = Math.max(k, Math.abs(v.x) / fx, Math.abs(v.y) / fy);
    }
    const min = Math.min(ZOOM_MAX, k > 0 ? .96 / k : ZOOM_MAX), max = ZOOM_MAX;
    if (intent === 'reset') { zoom = Math.sqrt(min * max); pan = { x: 0, z: 0 }; }
    else if (intent === 'fit') { zoom = min; pan = { ...centrePan }; }
    intent = undefined;
    zoom = Math.min(max, Math.max(min, zoom));
    pan.x = Math.min(a.maxX - g0.x, Math.max(a.minX - g0.x, pan.x));
    pan.z = Math.min(zHi - g0.z, Math.max(zLo - g0.z, pan.z));
    cam.zoom = zoom; cam.updateProjectionMatrix();
    cam.position.set(base.x + pan.x, base.y, base.z + pan.z); cam.updateMatrixWorld(true);
    if (live) scene!.render();
    overlays();
    viewState = { zoom, min, max, atMin: zoom <= min * 1.0001, atMax: zoom >= max * .9999 };
    callbacks.view?.(viewState);
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
    scene?.render(); overlays(); callbacks.selection?.(items);
  }
  function at(x: number, y: number) {
    return groundAt(x, y, scene?.canvas.getBoundingClientRect() ?? parent.getBoundingClientRect(), scene?.camera ?? blankCamera, scene?.worldRoot ?? blankRoot);
  }
  function pick(x: number, y: number): Selection | null {
    if (!scene || !level || stale) return null;
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
  function updateCursor() { parent.style.cursor = gesture?.pan ? 'grabbing' : hand || space ? 'grab' : ''; }
  function cancel() { for (const node of groupGhosts) node.remove(); groupGhosts.length = 0; gesture = undefined; placement = undefined; ghostPoint = null; ghost.hidden = true; marquee.hidden = true; updateCursor(); }
  function down(event: PointerEvent) {
    if (!scene || gesture || placement || !event.isPrimary || ![0, 1, 2].includes(event.button)) return;
    const panning = event.button !== 0 || event.altKey || hand || space;
    if (stale && !panning) return; // selection, drag-move and marquee would target ids from the previous level
    const hit = panning ? null : pick(event.clientX, event.clientY);
    const item = hit && (hit.kind === 'building' ? workingDoc?.buildings : workingDoc?.elements)?.find(item => item.id === hit.id);
    if (!panning) {
      const included = hit && selection.some(item => item.kind === hit.kind && item.id === hit.id);
      if (event.shiftKey && hit) choose(included ? selection.filter(item => item.kind !== hit.kind || item.id !== hit.id) : [...selection, hit]);
      else if (!included) choose(hit ? [hit] : []);
    }
    gesture = { targets: [...selection], id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, pan: panning, empty: hit === null, target: hit, origin: item ? { ...item.pos } : null, start: at(event.clientX, event.clientY) };
    scene.canvas.setPointerCapture(event.pointerId); event.preventDefault(); updateCursor();
  }
  function move(event: PointerEvent) {
    callbacks.pointer?.(at(event.clientX, event.clientY));
    if (!gesture || gesture.id !== event.pointerId || !scene) return;
    if (gesture.pan) {
      const a = at(gesture.lastX, gesture.lastY), b = at(event.clientX, event.clientY);
      if (a && b) { pan.x += a.x - b.x; pan.z -= a.z - b.z; frameCamera(); }
    } else if (gesture.target && gesture.origin && gesture.start) {
      const p = Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5 ? at(event.clientX, event.clientY) : null;
      showGhost(p && gesture.targets.some(item => item.kind === gesture!.target!.kind && item.id === gesture!.target!.id) ? clampPoint(snapPosition({ x: gesture.origin.x + p.x - gesture.start.x, z: gesture.origin.z + p.z - gesture.start.z }), currentArea()) : null, `${gesture.target.id}${gesture.targets.length > 1 ? ` +${gesture.targets.length - 1}` : ''}`);
      for (const node of groupGhosts) node.remove(); groupGhosts.length = 0;
      if (ghostPoint) for (const target of gesture.targets) {
        if (target.id === gesture.target.id && target.kind === gesture.target.kind) continue;
        const item = (target.kind === 'building' ? workingDoc?.buildings : workingDoc?.elements)?.find(item => item.id === target.id);
        if (!item) continue;
        const p = screenPoint(item.pos.x + ghostPoint.x - gesture.origin.x, item.pos.z + ghostPoint.z - gesture.origin.z), rect = parent.getBoundingClientRect();
        const node = document.createElement('div'); node.className = 'editor-ghost editor-group-ghost'; node.textContent = item.id;
        Object.assign(node.style, { left: `${p.x - rect.left}px`, top: `${p.y - rect.top}px` }); parent.append(node); groupGhosts.push(node);
      }
    } else if (gesture.empty && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5) {
      const rect = parent.getBoundingClientRect(); marquee.hidden = false;
      Object.assign(marquee.style, { left: `${Math.min(gesture.x, event.clientX) - rect.left}px`, top: `${Math.min(gesture.y, event.clientY) - rect.top}px`, width: `${Math.abs(event.clientX - gesture.x)}px`, height: `${Math.abs(event.clientY - gesture.y)}px` });
    }
    gesture.lastX = event.clientX; gesture.lastY = event.clientY;
  }
  function up(event: PointerEvent) {
    if (!gesture || gesture.id !== event.pointerId) return;
    if (!gesture.pan && gesture.target && ghostPoint && inside(event.clientX, event.clientY)) {
      callbacks.edit?.({ type: 'move-selection', targets: gesture.targets, delta: { x: ghostPoint.x - gesture.origin!.x, z: ghostPoint.z - gesture.origin!.z } });
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
    callbacks.pointer?.(point); showGhost(point ? clampPoint(snapPosition(point), currentArea()) : null, placement.item);
  }
  function dragUp(event: PointerEvent) {
    if (!placement || event.pointerId !== placement.id) return;
    const item = placement.item, pos = inside(event.clientX, event.clientY) ? at(event.clientX, event.clientY) : null;
    cancel();
    if (pos) callbacks.edit?.({ type: 'place', item, pos: clampPoint(snapPosition(pos), currentArea()) });
  }
  window.addEventListener('pointermove', dragMove); window.addEventListener('pointerup', dragUp); window.addEventListener('pointercancel', cancel);
  function wheel(event: WheelEvent) { if (!workingDoc) return; event.preventDefault(); zoomBy(Math.exp(-event.deltaY * .001), { x: event.clientX, y: event.clientY }); }
  function context(event: Event) { event.preventDefault(); }
  const handlers = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: cancel, lostpointercapture: cancel, wheel, contextmenu: context };
  for (const [name, handler] of Object.entries(handlers)) parent.addEventListener(name, handler as EventListener, { passive: false });
  /** Zoom by a factor; with an anchor (client px) the ground point under it stays put. */
  function zoomBy(factor: number, anchor?: { x: number; y: number }) {
    const before = anchor && at(anchor.x, anchor.y);
    zoom *= factor; frameCamera();
    const after = before && anchor && at(anchor.x, anchor.y);
    if (before && after) { const zs = isLive() ? -1 : 1; pan.x += before.x - after.x; pan.z += zs * (before.z - after.z); frameCamera(); }
  }
  function fitArea() { if (!workingDoc) return; intent = 'fit'; frameCamera(); }
  function gameCamera() {
    if (!workingDoc) return;
    if (isLive()) { frameBox = computeFrameBox(); zoom = 1; pan = { x: 0, z: 0 }; frameCamera(); } else fitArea();
  }
  function clearScene() { scene?.dispose(); scene = undefined; level = undefined; sim = undefined; stale = false; }
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
    const newDoc = frameDocId !== doc.id;
    workingDoc = doc;
    choose(nextSelection);
    report({ message: 'Loading preview…' });
    try {
      resources ??= loadManifest().then(value => ({ manifest: value, catalog: loadCatalog(contentFiles(), { themes: Object.keys(value.themes), colorKeys: Object.keys(value.palettes) }) }));
      const loaded = await resources;
      if (disposed || token !== generation) return;
      manifest = loaded.manifest;
      const start = performance.now();
      // requires is derived; don't mutate the editable document merely to preview it.
      // A blank draft (zero buildings) fails the schema's minItems, but must still render its ground; compile it unvalidated.
      const authored = { ...doc, requires: computeRequires(loaded.catalog, doc) };
      const parsed = doc.buildings.length ? loadLevel(loaded.catalog, authored) : { level: authored as unknown as Parameters<typeof compileLevel>[1] };
      const next = compileLevel(loaded.catalog, parsed.level), nextSim = create(next, 1);
      const compiledAt = performance.now();
      if (scene && level?.theme !== next.theme) clearScene();
      if (!scene) {
        scene = createLevelScene({ level: next, view: nextSim.view, manifest, parent, worldOptions: { textureLoader: loadTexture }, groundExtent: groundExtent() });
        await scene.ready;
      } else await scene.world.setLevel(next, next.theme, groundExtent());
      if (disposed || token !== generation) return;
      const sceneAt = performance.now();
      level = next; sim = nextSim; stale = false;
      if (newDoc) { frameBox = undefined; intent = 'reset'; }
      frameDocId = doc.id;
      scene.update({ view: sim.view, troops: createTroopBuffer(0), n: 0, alpha: 0, towerRadiusMilli: sim.towerRadiusMilli.bind(sim) }, [], 0);
      const rebuiltAt = performance.now();
      frameCamera(); choose(selection);
      report({ message: 'Ready', rebuildMs: rebuiltAt - start, compileMs: compiledAt - start, sceneMs: sceneAt - compiledAt, firstFrameMs: performance.now() - start });
    } catch (error) {
      if (disposed || token !== generation) return;
      const reason = error instanceof Error ? error.message : String(error);
      if (scene && level && sim) { stale = true; report({ message: 'Preview out of date', error: reason }); return; }
      clearScene(); frameBox = undefined; frameDocId = doc.id; if (newDoc) intent = 'reset'; frameCamera(); report({ message: `Preview unavailable: ${reason}` });
    }
  }
  return {
    /** Serializes asset rebuilds; superseded requests are skipped, and no stale result enables picking. */
    setDocument(doc: LevelDoc) { const token = ++generation; pending = pending.then(() => rebuild(doc, token)); return pending; },
    beginPlacement(item: LibraryItem, pointerId: number) { cancel(); placement = { item, id: pointerId }; },
    setLos(value: { from: string; to: string }) { los = value; overlays(); },
    setHand(on: boolean) { hand = on; updateCursor(); },
    setSpace(on: boolean) { space = on; updateCursor(); },
    setGrid(on: boolean) { grid = on; overlays(); },
    cancelPlacement(): boolean { if (!placement) return false; cancel(); return true; },
    setArea(next: Area) { area = next; scheduleFrame(); overlays(); },
    zoomBy, fitArea, gameCamera, pick,
    get viewState() { return viewState; }, groundAt: at, select: choose,
    get inspection() { return scene; },
    get previewSim() { return sim; },
    get selected() { return selection; },
    dispose() {
      disposed = true; generation++; cancel(); observer.disconnect(); cancelAnimationFrame(renderFrame);
      for (const [name, handler] of Object.entries(handlers)) parent.removeEventListener(name, handler as EventListener);
      window.removeEventListener('pointermove', dragMove); window.removeEventListener('pointerup', dragUp); window.removeEventListener('pointercancel', cancel);
      clearScene(); marquee.remove(); ghost.remove(); overlay.remove();
    },
  };
}
export type EditorViewport = ReturnType<typeof createEditorViewport>;
