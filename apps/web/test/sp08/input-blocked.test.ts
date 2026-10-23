import { expect, it } from 'vitest';
import { Group, PerspectiveCamera, Vector3 } from 'three';
import type { Sim } from '@node-arena/sim';
import { createInputController } from '../../src/input/index.js';
import { COMMANDS } from '@node-arena/defs';
import { DRAW_REASON_TEXT } from '../../src/input/reasons.js';
class Element {
  style: Record<string,string>={}; textContent=''; hidden=false; children: Element[]=[]; dataset: Record<string,string>={};
  append(...children: Element[]) {this.children.push(...children);} remove() {this.hidden=true;}
  setAttribute() {}
}
class Canvas extends EventTarget {
  style={touchAction:'',cursor:''}; body=new Element();
  ownerDocument={defaultView:new EventTarget(),body:this.body,createElement:()=>new Element()};
  getBoundingClientRect(){return {left:0,top:0,width:1000,height:1000};}
  setPointerCapture(){} hasPointerCapture(){return false;} releasePointerCapture(){}
}
function pointer(canvas:Canvas,type:string,x:number,y:number) {const e=new Event(type);Object.assign(e,{clientX:x,clientY:y,button:0,pointerId:1,pointerType:'mouse',isPrimary:true});canvas.dispatchEvent(e);}
it('gives every public rejection a friendly label',()=>{
  for(const reason of new Set(Object.values(COMMANDS).flatMap(c=>c.rejectReasons))) expect(DRAW_REASON_TEXT[reason]).toMatch(/[A-Z].{5}/);
});
it('shows a red blocked preview, cursor reason, mirrored milli-unit blocker point, and flashes source without a command',()=>{
  const canvas=new Canvas(), camera=new PerspectiveCamera(45,1,.1,100);camera.position.set(0,10,12);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const root=new Group();root.scale.z=-1;root.updateMatrixWorld();const anchors=[new Vector3(-2,0,1),new Vector3(2,0,1)];
  const previews:unknown[]=[],commands:unknown[]=[],selected:unknown[]=[];let time=0,reason: 'blocked-obstacle' | null='blocked-obstacle';
  const sim={view:{players:[{kind:'human',colorKey:'blue'}],ids:{buildings:['a','b']},buildings:{owner:[0,-1]},buildingStatic:[{drawsLines:true},{drawsLines:true}],lines:[],over:null},canDraw:()=>reason,explainDraw:()=>({reason:'blocked-obstacle',point:{x:500,z:1000},ref:'rock'})} as unknown as Sim;
  const input=createInputController({canvas:canvas as unknown as HTMLCanvasElement,sim,camera,worldRoot:root,now:()=>time,world:{anchors:{building:(id:string)=>({pos:anchors[id==='a'?0:1]!,radius:.7,labelPos:new Vector3()})},pickMeshes:[],previewLane:(_a,_b,c)=>previews.push(c),clearPreview:()=>{},select:i=>selected.push(i)},driver:{submit:c=>commands.push(c)}});
  const screen=(p:Vector3)=>{p=p.clone().applyMatrix4(root.matrixWorld).project(camera);return {x:(p.x+1)*500,y:(1-p.y)*500};};const a=screen(anchors[0]!),b=screen(anchors[1]!);
  pointer(canvas,'pointerdown',a.x,a.y);pointer(canvas,'pointermove',b.x,b.y);
  expect(previews.at(-1)).toBe('red'); const label=canvas.body.children.find(e=>e.dataset.inputFeedback==='reason')!;const marker=canvas.body.children.find(e=>e.dataset.inputFeedback==='blocker')!;
  expect(label.textContent).toBe(DRAW_REASON_TEXT['blocked-obstacle']);expect(label.hidden).toBe(false);expect(parseFloat(label.style.left!)).toBeCloseTo(b.x+16);
  const block=screen(new Vector3(.5,.06,1));expect(parseFloat(marker.style.left!)).toBeCloseTo(block.x);expect(parseFloat(marker.style.top!)).toBeCloseTo(block.y);
  pointer(canvas,'pointerup',b.x,b.y);expect(commands).toEqual([]);expect(selected.at(-1)).toBe(0);expect(label.hidden).toBe(true);expect(marker.hidden).toBe(true);
  time=301;input.refresh();expect(selected.at(-1)).toBe(null);
  pointer(canvas,'pointerdown',a.x,a.y);pointer(canvas,'pointermove',b.x,b.y);expect(label.hidden).toBe(false);input.cancel();expect(label.hidden).toBe(true);expect(marker.hidden).toBe(true);
  reason=null;pointer(canvas,'pointerdown',a.x,a.y);pointer(canvas,'pointermove',b.x,b.y);expect(label.hidden).toBe(true);expect(previews.at(-1)).toBe('blue');input.cancel();
  pointer(canvas,'pointerdown',a.x,a.y);pointer(canvas,'pointermove',500,750);expect(previews.at(-1)).toBe('red');pointer(canvas,'pointerup',500,750);expect(commands).toEqual([]);expect(selected.at(-1)).toBe(0);
  input.cancel();expect(selected.at(-1)).toBe(null);input.dispose();expect(canvas.body.children.every(e=>e.hidden)).toBe(true);
});
