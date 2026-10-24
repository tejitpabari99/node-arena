import { Box3, Vector3, type Mesh, type Object3D, type Sprite } from 'three';
import type { AppController } from '../app/state';
import type { createLevelScene } from '../render/scene';
type LevelScene=ReturnType<typeof createLevelScene>;
/** Anchors are in the data frame; worldRoot owns the mirror. Screen points use CSS pixels. */
export function projectAnchor(stage:LevelScene,id:string,label=false) {
  const anchor=stage.world.anchors.building(id);if(!anchor)throw Error(`Unknown building ${id}`);
  stage.scene.updateMatrixWorld(true);stage.camera.updateMatrixWorld(true);
  const p:Vector3=(label?anchor.labelPos:anchor.pos).clone().applyMatrix4(stage.worldRoot.matrixWorld).project(stage.camera);
  const rect=stage.canvas.getBoundingClientRect();
  return {x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2};
}
function mapRect(stage:LevelScene) {
  const rect=stage.canvas.getBoundingClientRect(),projected=new Box3(),point=new Vector3(),bounds=stage.bounds;
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]) {
    point.set(x,y,z).project(stage.camera);
    projected.expandByPoint(new Vector3(rect.left+(point.x+1)*rect.width/2,rect.top+(1-point.y)*rect.height/2,0));
  }
  return {x:projected.min.x,y:projected.min.y,w:projected.max.x-projected.min.x,h:projected.max.y-projected.min.y};
}
/** Debug-only projected bounds of actual visible meshes and camera-facing label sprites. */
function buildingRects(stage:LevelScene,index:number,id:string) {
  const rect=stage.canvas.getBoundingClientRect(),model=new Box3(),point=new Vector3();
  const visible=(object:Object3D)=>{for(let node:Object3D|null=object;node;node=node.parent)if(!node.visible)return false;return true;};
  const include=(box:Box3,p:Vector3)=>{p.project(stage.camera);box.expandByPoint(new Vector3(rect.left+(p.x+1)*rect.width/2,rect.top+(1-p.y)*rect.height/2,0));};
  for(const mesh of stage.world.pickMeshes) {
    if(mesh.userData.buildingIndex!==index||!visible(mesh))continue;
    const geometry=(mesh as Mesh).geometry;geometry.computeBoundingBox();const box=geometry.boundingBox;if(!box)continue;
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])include(model,point.set(x,y,z).applyMatrix4(mesh.matrixWorld));
  }
  const anchor=stage.world.anchors.building(id),label=new Box3();
  if(anchor) {
    const expected=anchor.labelPos.clone().applyMatrix4(stage.worldRoot.matrixWorld);
    stage.scene.traverse(object=>{
      const sprite=object as Sprite;if(!sprite.isSprite||!visible(sprite))return;
      const center=sprite.getWorldPosition(new Vector3());if(center.distanceToSquared(expected)>1e-8)return;
      const scale=sprite.getWorldScale(new Vector3()),right=new Vector3().setFromMatrixColumn(stage.camera.matrixWorld,0),up=new Vector3().setFromMatrixColumn(stage.camera.matrixWorld,1),rotation=sprite.material.rotation;
      for(const x of [-sprite.center.x,1-sprite.center.x])for(const y of [-sprite.center.y,1-sprite.center.y]) {
        const sx=x*scale.x,sy=y*scale.y,rx=sx*Math.cos(rotation)-sy*Math.sin(rotation),ry=sx*Math.sin(rotation)+sy*Math.cos(rotation);
        include(label,point.copy(center).addScaledVector(right,rx).addScaledVector(up,ry));
      }
    });
  }
  const result=(box:Box3)=>box.isEmpty()?null:{x:box.min.x,y:box.min.y,w:box.max.x-box.min.x,h:box.max.y-box.min.y};
  return {modelRect:result(model),labelRect:result(label)};
}
export function buildVisualProbe(app:AppController,stage:LevelScene|undefined) {
  const state=app.snapshot(),view=app.driver?.sim.view;
  stage?.scene.updateMatrixWorld(true);stage?.camera.updateMatrixWorld(true);
  return {viewport:{w:window.innerWidth,h:window.innerHeight},screen:state.screen,popup:state.restartPopup?'restart':state.result?'result':null,
    hud:{remainingSeconds:state.remainingSeconds,ownership:app.driver?.ownership??[],levelId:state.levelId},
    mapRect:stage?mapRect(stage):null,
    buildings:stage&&view?view.ids.buildings.map((id,index)=>({id,index,owner:view.buildings.owner[index],level:view.buildings.level[index],point:projectAnchor(stage,id),label:projectAnchor(stage,id,true),...buildingRects(stage,index,id)})):[],
    lines:view?.lines.map(line=>({...line}))??[],
  };
}
