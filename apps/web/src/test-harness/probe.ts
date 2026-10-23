import type { Vector3 } from 'three';
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
export function buildVisualProbe(app:AppController,stage:LevelScene|undefined) {
  const state=app.snapshot(),view=app.driver?.sim.view;
  return {viewport:{w:window.innerWidth,h:window.innerHeight},screen:state.screen,popup:state.restartPopup?'restart':state.result?'result':null,
    hud:{remainingSeconds:state.remainingSeconds,ownership:app.driver?.ownership??[],levelId:state.levelId},
    buildings:stage&&view?view.ids.buildings.map((id,index)=>({id,index,owner:view.buildings.owner[index],level:view.buildings.level[index],point:projectAnchor(stage,id),label:projectAnchor(stage,id,true)})):[],
    lines:view?.lines.map(line=>({...line}))??[],
  };
}
