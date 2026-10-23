import { BufferAttribute, BufferGeometry, Line, LineBasicMaterial, Matrix4, Plane, Raycaster, Vector2, Vector3, type Intersection, type Mesh, type Object3D, type PerspectiveCamera, type Scene } from 'three';
import type { Command, Sim, DrawExplanation, RejectReason } from '@node-arena/sim';
import type { WorldRenderer } from '../render/world.js';
import type { BuildingAnchor } from '../render/building.js';
import { DRAW_REASON_TEXT } from './reasons.js';
import { segmentDistance } from './geometry.js';
import { createGestureMachine, type GesturePoint } from './gestures.js';

export interface InputControllerOptions {
  canvas: HTMLCanvasElement; sim: Sim; camera: PerspectiveCamera;
  world: Pick<WorldRenderer,'anchors' | 'pickMeshes' | 'previewLane' | 'clearPreview' | 'select'>;
  worldRoot: Object3D; scene?: Scene;
  driver: { submit(command: Command): unknown };
  isEnabled?(): boolean; now?(): number;
}
/** Public sim read API only; the driver's submit owns command tick stamps. */
export function createInputController(options: InputControllerOptions) {
  const {canvas,sim,camera,world,worldRoot}=options;
  const now=options.now ?? (()=>performance.now());
  const ray=new Raycaster(), ndc=new Vector2(), ground=new Plane(new Vector3(0,1,0),0), hit=new Vector3(), inverse=new Matrix4();
  const projected=new Vector3(), offset=new Vector3(), intersections: Intersection[]=[];
  const anchors: (BuildingAnchor | undefined)[]=sim.view.ids.buildings.map(id=>world.anchors.building(id));
  const screens=anchors.map(()=>({x:0,y:0,radius:0}));
  const pickMeshes: Mesh[]=world.pickMeshes;
  const point: GesturePoint={x:0,y:0,building:null}, start={x:0,z:0}, end={x:0,z:0};
  const positions=new Float32Array(128*3), trailGeometry=new BufferGeometry();
  const trailAttribute=new BufferAttribute(positions,3); trailGeometry.setAttribute('position',trailAttribute);trailGeometry.setDrawRange(0,0);
  const trailMaterial=new LineBasicMaterial({color:0xffffff,transparent:true,opacity:.8,depthWrite:false});
  const trail=new Line(trailGeometry,trailMaterial);trail.visible=false;trail.frustumCulled=false;trail.renderOrder=4;options.scene?.add(trail);
  let trailCount=0,disposed=false,width=1,height=1,left=0,top=0,groundHit=false;
  const oldTouch=canvas.style.touchAction,oldCursor=canvas.style.cursor;
  canvas.style.touchAction='none';
  const human=sim.view.players.findIndex(player=>player.kind==='human');
  const enabled=()=>!disposed && human>=0 && !sim.view.over && (options.isEnabled?.() ?? true);
  function measure() {const box=canvas.getBoundingClientRect();width=box.width || 1;height=box.height || 1;left=box.left;top=box.top;}
  function projectAnchors() {
    camera.updateMatrixWorld();worldRoot.updateWorldMatrix(true,false);inverse.copy(worldRoot.matrixWorld).invert();
    for(let i=0;i<anchors.length;i++) {
      const a=anchors[i];if(!a) continue;
      projected.copy(a.pos).applyMatrix4(worldRoot.matrixWorld).project(camera);
      const p=screens[i]!;p.x=(projected.x+1)*width/2;p.y=(1-projected.y)*height/2;
      offset.copy(a.pos);offset.x+=a.radius;offset.applyMatrix4(worldRoot.matrixWorld).project(camera);
      p.radius=Math.abs((offset.x-projected.x)*width/2);
    }
  }
  function groundAt(x: number,y: number) {
    ndc.set(x/width*2-1,1-y/height*2);ray.setFromCamera(ndc,camera);
    groundHit=ray.ray.intersectPlane(ground,hit)!==null;
    if(groundHit) hit.applyMatrix4(inverse);
    return groundHit;
  }
  function local(event: PointerEvent) {
    point.x=event.clientX-left;point.y=event.clientY-top;point.building=null;
    if(!groundAt(point.x,point.y)) return point;
    // Mesh hit catches roofs; footprint radius catches a building's ground anchor.
    intersections.length=0;ray.intersectObjects(pickMeshes,false,intersections);
    for(const intersection of intersections) {
      const i=intersection.object.userData.buildingIndex as number | undefined;
      if(i!==undefined && anchors[i]) { point.building=i;return point; }
    }
    let nearest=Infinity;
    for(let i=0;i<anchors.length;i++) {
      const a=anchors[i];if(!a) continue;
      const d=Math.hypot(hit.x-a.pos.x,hit.z-a.pos.z)/a.radius;
      if(d<=1 && d<nearest) {nearest=d;point.building=i;}
    }
    return point;
  }
  let label: HTMLDivElement | undefined, marker: HTMLDivElement | undefined;
  let flashUntil=0, flashing=false, lastFrom=-1, lastTo=-1, lastReason: RejectReason | null=null;
  let explanation: DrawExplanation | null=null;
  function clearFeedback() {if(label) label.hidden=true;if(marker) marker.hidden=true;lastFrom=-1;lastTo=-1;lastReason=null;explanation=null;}
  function clearFlash() {if(flashing) world.select(null);flashing=false;}
  function feedback(from: number,to: number,reason: RejectReason,x: number,y: number) {
    if(!label) {
      label=canvas.ownerDocument.createElement('div');label.dataset.inputFeedback='reason';label.setAttribute('role','status');
      Object.assign(label.style,{position:'fixed',zIndex:'20',pointerEvents:'none',background:'#8b1828',color:'#fff',padding:'6px 10px',borderRadius:'8px',font:'bold 14px sans-serif',maxWidth:'240px'});
      marker=canvas.ownerDocument.createElement('div');marker.dataset.inputFeedback='blocker';marker.setAttribute('aria-hidden','true');
      Object.assign(marker.style,{position:'fixed',zIndex:'19',pointerEvents:'none',width:'14px',height:'14px',border:'3px solid #ff394d',borderRadius:'50%',background:'#fff',transform:'translate(-50%,-50%)'});
      canvas.ownerDocument.body.append(label,marker);
    }
    if(label.textContent!==DRAW_REASON_TEXT[reason]) label.textContent=DRAW_REASON_TEXT[reason];
    label.style.left=`${left+x+16}px`;label.style.top=`${top+y+16}px`;label.hidden=false;
    if(from!==lastFrom || to!==lastTo || reason!==lastReason) {explanation=sim.explainDraw(human,from,to);lastFrom=from;lastTo=to;lastReason=reason;}
    marker!.hidden=explanation===null;
    if(explanation) {
      projected.set(explanation.point.x/1000,.06,explanation.point.z/1000).applyMatrix4(worldRoot.matrixWorld).project(camera);
      marker!.style.left=`${left+(projected.x+1)*width/2}px`;marker!.style.top=`${top+(1-projected.y)*height/2}px`;
    }
  }
  function release(id: number) {try {if(canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);} catch { /* Detached canvas. */ }}
  const machine=createGestureMachine({now,diagonal:()=>Math.hypot(width,height),own:i=>sim.view.buildings.owner[i]===human && sim.view.buildingStatic[i]!.drawsLines,
    canDraw:(from,to)=>sim.canDraw(human,from,to)===null,
    blocked:from=>{world.select(from);flashing=true;flashUntil=now()+300;},
    draw:(from,to)=>{if(enabled()) options.driver.submit({type:'DrawLine',player:human,from,to});},
    stroke:(a,b,seen)=>{
      if(!enabled()) return;
      for(const line of sim.view.lines) {
        if(line.owner!==human || seen.has(line.channel)) continue;
        const from=screens[line.from],to=screens[line.to];if(!from || !to) continue;
        if(segmentDistance(a,b,from,to)<=8) {seen.add(line.channel);options.driver.submit({type:'CutLine',player:human,from:line.from,to:line.to});}
      }
    },
    preview:(from,p)=>{
      const a=anchors[from];if(!a || !groundAt(p.x,p.y)) {world.clearPreview();clearFeedback();return;}
      const target=p.building===null?undefined:anchors[p.building];start.x=a.pos.x;start.z=a.pos.z;end.x=target?.pos.x ?? hit.x;end.z=target?.pos.z ?? hit.z;
      const reason=p.building===null ? null : sim.canDraw(human,from,p.building);
      const valid=p.building!==null && reason===null;
      world.previewLane(start,end,valid?sim.view.players[human]!.colorKey:'red');
      if(reason!==null && p.building!==null) feedback(from,p.building,reason,p.x,p.y);else clearFeedback();
    },
    clear:()=>{clearFeedback();world.clearPreview();trail.visible=false;trailCount=0;trailGeometry.setDrawRange(0,0);},
    eraser:active=>{canvas.style.cursor=active?'crosshair':oldCursor;},
    trail:p=>{
      if(!groundAt(p.x,p.y)) return;
      if(trailCount===128) {positions.copyWithin(0,3);trailCount--;}
      projected.set(hit.x,.075,hit.z).applyMatrix4(worldRoot.matrixWorld);
      trailAttribute.setXYZ(trailCount++,projected.x,projected.y,projected.z);trailAttribute.needsUpdate=true;trailGeometry.setDrawRange(0,trailCount);trail.visible=true;
    },
  });
  function cancel() {clearFlash();const id=machine.pointer;const active=machine.cancel();if(id>=0) release(id);return active;}
  function refresh() {if(!enabled()) {cancel();return;}if(flashing && now()>=flashUntil) clearFlash();projectAnchors();machine.refresh();}
  function down(event: PointerEvent) {
    if(!enabled()) {cancel();return;} if(!event.isPrimary || machine.pointer>=0) return;
    clearFlash();measure();projectAnchors();if(!machine.down(event.pointerId,event.pointerType,event.button,local(event))) return;
    event.preventDefault();try {canvas.setPointerCapture(event.pointerId);} catch { /* Synthetic pointer. */ }
  }
  function move(event: PointerEvent) {if(!enabled()) {cancel();return;}if(machine.pointer!==event.pointerId) return;machine.move(event.pointerId,local(event));event.preventDefault();}
  function up(event: PointerEvent) {if(!enabled()) {cancel();return;}if(machine.pointer!==event.pointerId) return;machine.up(event.pointerId,local(event));release(event.pointerId);event.preventDefault();}
  function lost(event: PointerEvent) {if(machine.pointer===event.pointerId) cancel();}
  function key(event: KeyboardEvent) {if(event.key==='Escape') cancel();}
  function context(event: Event) {event.preventDefault();}
  const handlers={pointerdown:down,pointermove:move,pointerup:up,pointercancel:lost,lostpointercapture:lost,contextmenu:context};
  for(const [name,handler] of Object.entries(handlers)) canvas.addEventListener(name,handler as EventListener);
  const window=canvas.ownerDocument.defaultView;
  window?.addEventListener('resize',measure);window?.addEventListener('blur',cancel);window?.addEventListener('keydown',key as EventListener);
  function dispose() {
    if(disposed) return;cancel();disposed=true;
    for(const [name,handler] of Object.entries(handlers)) canvas.removeEventListener(name,handler as EventListener);
    window?.removeEventListener('resize',measure);window?.removeEventListener('blur',cancel);window?.removeEventListener('keydown',key as EventListener);
    canvas.style.touchAction=oldTouch;canvas.style.cursor=oldCursor;
    label?.remove();marker?.remove();
    trail.removeFromParent();trailGeometry.dispose();trailMaterial.dispose();
  }
  measure();projectAnchors();
  return {refresh,cancel,dispose};
}
