import { BufferGeometry, Float32BufferAttribute, Mesh, Line, LineBasicMaterial, Plane, Raycaster, Vector2, Vector3, type Camera, type Scene } from 'three';
import type { Manifest } from '@node-arena/content';
import type { Command, Sim } from '@node-arena/sim';
import { Disposables } from '../render/disposables.js';
import type { LineSegment, ProjectedLineSegment } from '../render/lines.js';
import { createLaneMaterial, LANE_WIDTH_FACTOR } from '../render/lane-material.js';
import { hoverRadius, pointSegmentDistance, segmentDistance, swipeRadius, type Point2 } from './geometry.js';

export interface InputLines {
  readonly segments?: readonly LineSegment[];
  projectSegments?(camera: Camera, width: number, height: number): readonly ProjectedLineSegment[];
  laneWidth?(a: number, b: number): number;
  setHighlighted?(channel: number | null, owner?: number): void;
}
export interface InputControllerOptions {
  canvas: HTMLCanvasElement; sim: Sim; camera: Camera; scene: Scene; manifest: Manifest; scope: Disposables;
  submit(command: Command): unknown;
  isEnabled?(): boolean;
  lines?: InputLines;
  palette?: keyof Manifest['palettes'];
}
type Gesture = { pointer: number; kind: 'draw'; from: number } | { pointer: number; kind: 'cut'; previous: Point2; cut: Set<number> };

/** Reads only the public view and canDraw; the driver owns command timing and all sim steps. */
export function createInputController(options: InputControllerOptions) {
  const scope = new Disposables(), ray = new Raycaster(), ground = new Plane(new Vector3(0,1,0),0);
  let canvas = options.canvas, disposed = false, gesture: Gesture | null = null, cursor: Point2 | null = null;
  let palette = options.palette ?? 'default';
  const previewGeometry = scope.add(new BufferGeometry());
  previewGeometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(12),3));
  previewGeometry.setAttribute('uv',new Float32BufferAttribute([0,0,0,1,1,0,1,1],2)); previewGeometry.setIndex([0,1,2,2,1,3]);
  // Ghost chevron ribbon: the lane shader, static (motion 0), translucent, one colour on the whole length.
  const previewMaterial = scope.add(createLaneMaterial({ value: 0 },{ value: 0 })); previewMaterial.uniforms.alphaMul!.value = .6; previewMaterial.uniforms.split!.value = 1;
  const preview = new Mesh(previewGeometry,previewMaterial); preview.visible = false; preview.frustumCulled = false; preview.renderOrder = 3; preview.userData.inputPreview = true;
  options.scene.add(preview); scope.defer(() => preview.removeFromParent());
  const trailGeometry = scope.add(new BufferGeometry());
  trailGeometry.setAttribute('position',new Float32BufferAttribute(new Float32Array(128*3),3)); trailGeometry.setDrawRange(0,0);
  const trail = new Line(trailGeometry,scope.add(new LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: .8, depthWrite: false })));
  trail.visible = false; trail.frustumCulled = false; trail.renderOrder = 3; options.scene.add(trail); scope.defer(() => trail.removeFromParent());
  let trailCount = 0;
  const reason = canvas.ownerDocument.createElement('div'); reason.dataset.inputReason = ''; reason.setAttribute('role','status');
  Object.assign(reason.style,{ position:'fixed', pointerEvents:'none', display:'none', zIndex:'20', padding:'4px 8px', color:'#fff', background:'#8c1826', borderRadius:'4px', fontSize:'14px' });
  canvas.ownerDocument.body.append(reason); scope.label(reason);
  function human() { return options.sim.view.players.findIndex(player => player.kind === 'human'); }
  function enabled() { return !disposed && !options.sim.view.over && human() >= 0 && (options.isEnabled?.() ?? true); }
  function local(event: MouseEvent): Point2 { const box = canvas.getBoundingClientRect(); return { x:event.clientX-box.left, y:event.clientY-box.top }; }
  function world(point: Point2): Vector3 | null {
    const box = canvas.getBoundingClientRect(); if (!box.width || !box.height) return null;
    options.camera.updateMatrixWorld(); ray.setFromCamera(new Vector2(point.x/box.width*2-1,1-point.y/box.height*2),options.camera);
    return ray.ray.intersectPlane(ground,new Vector3());
  }
  function pick(point: Vector3): number | null {
    let found: number | null = null, nearest = Infinity;
    options.sim.view.towerStatic.forEach((tower,index) => {
      const radius = tower.footprintRadius/1000*1.25, distance = Math.hypot(point.x-tower.x/1000,point.z-tower.y/1000);
      if (radius > 0 && distance < radius && distance/radius < nearest) { found = index; nearest = distance/radius; }
    }); return found;
  }
  function towerPoint(index: number) { const tower = options.sim.view.towerStatic[index]!; return new Vector3(tower.x/1000,0,tower.y/1000); }
  function project(point: Vector3, width: number, height: number): Point2 { const p = point.clone().project(options.camera); return { x:(p.x+1)*width/2,y:(1-p.y)*height/2 }; }
  function projectedLines(): readonly { channel: number; owner: number; start: Point2; end: Point2; halfWidthPx: number }[] {
    const box = canvas.getBoundingClientRect(); options.camera.updateMatrixWorld();
    return options.lines?.projectSegments?.(options.camera,box.width,box.height) ?? options.sim.view.lines.map(line =>
      ({ channel:line.channel,owner:line.owner,start:project(towerPoint(line.from),box.width,box.height),end:project(towerPoint(line.to),box.width,box.height),halfWidthPx:0 }));
  }
  function highlight(channel: number | null) { options.lines?.setHighlighted?.(channel, human()); }
  function nearestLine(point: Point2) {
    let selected: number | null = null, best = Infinity;
    for (const line of projectedLines()) if (line.owner === human()) {
      const distance = pointSegmentDistance(point,line.start,line.end);
      if (distance <= hoverRadius(line.halfWidthPx) && distance < best) { best = distance; selected = line.channel; }
    }
    return selected;
  }
  function command(type: Command['type'], from: number, to: number) {
    if (!enabled()) return;
    const view = options.sim.view;
    options.submit({ type, player:view.ids.players[human()]!, from:view.ids.towers[from]!, to:view.ids.towers[to]! });
  }
  function cut(channel: number) { const line = options.sim.view.lines.find(line => line.channel === channel && line.owner === human()); if (line) command('CutLine',line.from,line.to); }
  function stroke(a: Point2, b: Point2, active: Extract<Gesture,{kind:'cut'}>) {
    for (const line of projectedLines()) if (line.owner === human() && !active.cut.has(line.channel) && segmentDistance(a,b,line.start,line.end) <= swipeRadius(line.halfWidthPx)) {
      active.cut.add(line.channel); cut(line.channel);
    }
  }
  function addTrail(point: Point2) {
    const p = world(point); if (!p) return;
    const positions = trailGeometry.getAttribute('position');
    if (trailCount === 128) { (positions.array as Float32Array).copyWithin(0,3); trailCount--; }
    positions.setXYZ(trailCount++,p.x,.065,p.z); positions.needsUpdate = true; trailGeometry.setDrawRange(0,trailCount); trail.visible = true;
  }
  function updatePreview(point: Point2, from: number) {
    const hit = world(point); if (!hit) { preview.visible = false; reason.style.display = 'none'; return; }
    const to = pick(hit), end = to === null ? hit : towerPoint(to), start = towerPoint(from), dx=end.x-start.x,dz=end.z-start.z,length=Math.hypot(dx,dz);
    const view = options.sim.view, lo = Math.min(from,to ?? from), hi = Math.max(from,to ?? from);
    const width = to === null ? (options.lines?.laneWidth?.(from,from) ?? LANE_WIDTH_FACTOR*2*view.towerStatic[from]!.footprintRadius/1000) : (options.lines?.laneWidth?.(lo,hi) ?? LANE_WIDTH_FACTOR*(view.towerStatic[from]!.footprintRadius+view.towerStatic[to]!.footprintRadius)/1000);
    const nx=length ? -dz/length*width/2 : 0,nz=length ? dx/length*width/2 : 0;
    const positions = previewGeometry.getAttribute('position');
    [[start.x-nx,start.z-nz],[start.x+nx,start.z+nz],[end.x-nx,end.z-nz],[end.x+nx,end.z+nz]].forEach(([x,z],i)=>positions.setXYZ(i,x!,.06,z!));
    positions.needsUpdate = true; preview.visible = true;
    const u = previewMaterial.uniforms; u.laneLen!.value = length || 1; u.laneW!.value = width; u.fade!.value = Math.max(.5,width*1.5);
    const rejection = to === null ? null : options.sim.canDraw(view.ids.players[human()]!,view.ids.towers[from]!,view.ids.towers[to]!);
    const tint = rejection ? '#e3384f' : options.manifest.palettes[palette][view.players[human()]!.colorKey]!; (u.colA!.value as { set(v: string): void }).set(tint); (u.colB!.value as { set(v: string): void }).set(tint);
    reason.textContent = rejection ?? ''; reason.style.display = rejection ? 'block' : 'none';
    const box = canvas.getBoundingClientRect(); reason.style.left = `${box.left+point.x+14}px`; reason.style.top = `${box.top+point.y+14}px`;
  }
  function cancel(): boolean {
    const active = gesture; gesture = null; preview.visible = trail.visible = false; trailCount = 0; reason.style.display = 'none'; highlight(null);
    if (active) { try { if (canvas.hasPointerCapture(active.pointer)) canvas.releasePointerCapture(active.pointer); } catch { /* Removed/replaced canvases have no live pointer. */ } }
    return active !== null;
  }
  function refresh() {
    if (!enabled()) { cancel(); return; }
    if (!cursor) return;
    if (gesture?.kind === 'draw') updatePreview(cursor,gesture.from);
    else if (!gesture) highlight(nearestLine(cursor));
  }
  function setPalette(value: keyof Manifest['palettes']) { if (disposed) return; palette = value; refresh(); }
  function down(event: PointerEvent) {
    if (!enabled()) { cancel(); return; }
    if (event.button !== 0 || !event.isPrimary || gesture) return;
    cursor = local(event); const hit = world(cursor); if (!hit) return;
    const tower = pick(hit), view = options.sim.view;
    if (tower !== null) {
      if (view.tower.owner[tower] !== human() || !view.towerStatic[tower]!.components.includes('drawsLines')) return;
      gesture = { kind:'draw',pointer:event.pointerId,from:tower }; updatePreview(cursor,tower);
    } else { gesture = { kind:'cut',pointer:event.pointerId,previous:cursor,cut:new Set() }; addTrail(cursor); }
    event.preventDefault(); highlight(null);
    try { canvas.setPointerCapture(event.pointerId); } catch { /* Synthetic events may have no active native pointer. */ }
  }
  function move(event: PointerEvent) {
    if (!enabled()) { cancel(); return; }
    if (!event.isPrimary || (gesture && gesture.pointer !== event.pointerId)) return;
    cursor = local(event);
    if (gesture?.kind === 'cut') { stroke(gesture.previous,cursor,gesture); gesture.previous = cursor; addTrail(cursor); }
    refresh();
  }
  function up(event: PointerEvent) {
    if (!enabled()) { cancel(); return; }
    if (!gesture || gesture.pointer !== event.pointerId || event.button !== 0) return;
    cursor = local(event);
    if (gesture.kind === 'draw') {
      const hit = world(cursor), to = hit ? pick(hit) : null, view = options.sim.view;
      if (to !== null && options.sim.canDraw(view.ids.players[human()]!,view.ids.towers[gesture.from]!,view.ids.towers[to]!) === null) command('DrawLine',gesture.from,to);
    } else stroke(gesture.previous,cursor,gesture);
    cancel(); refresh();
  }
  function context(event: MouseEvent) {
    event.preventDefault(); if (!enabled()) { cancel(); return; }
    cancel(); cursor = local(event); const line = nearestLine(cursor); if (line !== null) cut(line); refresh();
  }
  function lost(event: PointerEvent) { if (gesture?.pointer === event.pointerId) cancel(); }
  function leave() { if (!gesture) { cursor = null; highlight(null); } }
  const handlers = { pointerdown:down,pointermove:move,pointerup:up,pointercancel:lost,lostpointercapture:lost,contextmenu:context,pointerleave:leave };
  function bind(target: HTMLCanvasElement, remove = false) {
    for (const [name,handler] of Object.entries(handlers)) {
      if (remove) target.removeEventListener(name,handler as EventListener);
      else target.addEventListener(name,handler as EventListener);
    }
  }
  function setCanvas(next: HTMLCanvasElement) { if (disposed || canvas === next) return; cancel(); bind(canvas,true); canvas=next; cursor=null; bind(canvas); }
  function dispose() { if (disposed) return; cancel(); disposed=true; bind(canvas,true); scope.dispose(); }
  bind(canvas); options.scope.defer(dispose);
  return { cancel,setCanvas,setPalette,refresh,dispose };
}
