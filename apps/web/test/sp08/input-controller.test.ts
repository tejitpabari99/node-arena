import { expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import type { Sim } from '@node-arena/sim';
import { createInputController } from '../../src/input/index.js';

class Canvas extends EventTarget {
  style = { touchAction:'',cursor:'' }; ownerDocument = { defaultView: new EventTarget() }; captures = new Set<number>();
  getBoundingClientRect() { return {left:0,top:0,width:1000,height:1000}; }
  setPointerCapture(i: number) { this.captures.add(i); } hasPointerCapture(i: number) { return this.captures.has(i); } releasePointerCapture(i: number) { this.captures.delete(i); }
}
function event(canvas: Canvas, type: string, x: number,y: number,button=0) { const e=new Event(type,{cancelable:true}); Object.assign(e,{clientX:x,clientY:y,button,pointerId:1,pointerType:'mouse',isPrimary:true}); canvas.dispatchEvent(e); return e; }
it('adapts pointer events to numeric driver commands and cleans up cancel listeners/capture', () => {
  const canvas=new Canvas(), camera=new PerspectiveCamera(45,1,.1,100); camera.position.set(0,10,12); camera.lookAt(0,0,0); camera.updateMatrixWorld();
  const root=new Group(); root.scale.z=-1; root.updateMatrixWorld(); const scene=new Scene(); scene.add(root);
  const points=[new Vector3(-2,0,1),new Vector3(2,0,1)]; const commands: unknown[]=[];
  const sim={view:{players:[{kind:'human',colorKey:'blue'}],ids:{buildings:['a','b']},buildings:{owner:[0,-1]},buildingStatic:[{x:-2000,z:1000,drawsLines:true},{x:2000,z:1000,drawsLines:true}],lines:[],over:null},canDraw:()=>null} as unknown as Sim;
  const world={anchors:{building:(id: string)=>({pos:points[id==='a'?0:1]!,radius:.7,labelPos:new Vector3()})},pickMeshes:[],previewLane:()=>{},clearPreview:()=>{},select:()=>{}};
  let enabled=true; const input=createInputController({canvas:canvas as unknown as HTMLCanvasElement,camera,worldRoot:root,scene,sim,world,driver:{submit:c=>commands.push(c)},isEnabled:()=>enabled});
  const screen=(i:number)=>{const p=points[i]!.clone().applyMatrix4(root.matrixWorld).project(camera);return [(p.x+1)*500,(1-p.y)*500] as const;};
  const [ax,ay]=screen(0),[bx,by]=screen(1);
  event(canvas,'pointerdown',ax,ay); event(canvas,'pointermove',bx,by); event(canvas,'pointerup',bx,by); expect(commands).toEqual([{type:'DrawLine',player:0,from:0,to:1}]); expect(canvas.captures.size).toBe(0);
  Object.assign(sim.view,{lines:[{channel:1,owner:0,from:0,to:1}]});
  event(canvas,'pointerdown',(ax+bx)/2,ay-100,2); event(canvas,'pointermove',(ax+bx)/2,ay+100,2); event(canvas,'pointerup',(ax+bx)/2,ay+100,2); expect(commands[1]).toEqual({type:'CutLine',player:0,from:0,to:1});
  for(const cancel of ['blur','Escape','popup','pointercancel','lostpointercapture']) {
    event(canvas,'pointerdown',ax,ay);
    if(cancel==='blur') canvas.ownerDocument.defaultView.dispatchEvent(new Event('blur'));
    else if(cancel==='Escape') {const e=new Event('keydown'); Object.assign(e,{key:'Escape'});canvas.ownerDocument.defaultView.dispatchEvent(e);}
    else if(cancel==='popup') {enabled=false;input.refresh();enabled=true;}
    else event(canvas,cancel,ax,ay);
    event(canvas,'pointerup',bx,by); expect(commands).toHaveLength(2); expect(canvas.captures.size).toBe(0);
  }
  Object.assign(sim.view.buildingStatic[0]!,{drawsLines:false});
  event(canvas,'pointerdown',ax,ay);event(canvas,'pointerup',bx,by);expect(commands).toHaveLength(2);
  expect(event(canvas,'contextmenu',ax,ay).defaultPrevented).toBe(true);
  input.dispose(); event(canvas,'pointerdown',ax,ay);event(canvas,'pointerup',bx,by);expect(commands).toHaveLength(2);
});

it('raycasts current-stage roofs after pick targets are replaced, ignoring stale hidden meshes', () => {
  const canvas=new Canvas(), camera=new PerspectiveCamera(45,1,.1,100);
  camera.position.set(0,10,12);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const root=new Group();root.scale.z=-1;
  const geometry=new BoxGeometry(.8,.5,.8), material=new MeshBasicMaterial();
  const stale=new Mesh(geometry,material), current=new Mesh(geometry,material);
  stale.position.set(-2,2,1);current.position.set(-2,5,1);
  stale.userData.buildingIndex=current.userData.buildingIndex=0;
  root.add(stale,current);root.updateMatrixWorld(true);
  const positions=[new Vector3(-2,0,1),new Vector3(2,0,1)];
  const commands: unknown[]=[];
  const sim={view:{players:[{kind:'human',colorKey:'blue'}],ids:{buildings:['source','target']},buildings:{owner:[0,-1]},buildingStatic:[{drawsLines:true},{drawsLines:true}],lines:[],over:null},canDraw:()=>null} as unknown as Sim;
  let picks=[stale];
  const world={anchors:{building:(id:string)=>({pos:positions[id==='source'?0:1]!,radius:.3,labelPos:new Vector3()})},get pickMeshes(){return picks;},previewLane:()=>{},clearPreview:()=>{},select:()=>{}};
  const input=createInputController({canvas:canvas as unknown as HTMLCanvasElement,camera,worldRoot:root,sim,world,driver:{submit:c=>commands.push(c)}});
  const screen=(p:Vector3)=>{const v=p.clone().applyMatrix4(root.matrixWorld).project(camera);return {x:(v.x+1)*500,y:(1-v.y)*500};};
  const target=screen(positions[1]!);
  const drag=(from:Vector3)=>{const start=screen(from);event(canvas,'pointerdown',start.x,start.y);event(canvas,'pointermove',target.x,target.y);event(canvas,'pointerup',target.x,target.y);};
  // Renderer replaces its stage-specific pick list after the controller has attached.
  stale.visible=false;current.visible=true;picks=[current];input.refresh();
  drag(current.position);
  expect(commands).toEqual([{type:'DrawLine',player:0,from:0,to:1}]);
  drag(stale.position);
  expect(commands).toHaveLength(1);
  input.dispose();geometry.dispose();material.dispose();
});
