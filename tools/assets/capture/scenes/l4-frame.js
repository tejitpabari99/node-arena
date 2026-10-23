// SP08 Task 1 proof: use the production camera + scene seam, independently of the parked legacy shell.
import * as THREE from 'three';
import manifest from '../../../../apps/web/assets/manifest.json';
import levels from '../fixtures/levels.json';
import { create, createTroopBuffer } from '../../../../packages/sim/src/index.ts';
import { createLevelScene } from '../../../../apps/web/src/render/scene.ts';

export default async ({canvas}) => {
  canvas.remove();
  const host = document.createElement('div'); host.style.cssText = 'width:100vw;height:100vh'; document.body.append(host);
  const level = levels['l4-green'], sim = create(level,11), troops = createTroopBuffer(4096);
  const stage = createLevelScene({ level,view:sim.view,manifest,parent:host,worldOptions:{baseURL:__WEB_ASSETS__} });
  await stage.ready;
  stage.update({view:sim.view,troops,n:0,alpha:0,towerRadiusMilli:sim.towerRadiusMilli},[],0);
  // Match SP07's L4 opening: real units establish weapon handedness as well as architecture/layout.
  const commands = [];
  level.buildings.forEach((a,from) => {
    if (a.owner < 0) return;
    let to = -1, distance = Infinity;
    level.buildings.forEach((b,i) => { const d = Math.hypot(a.x-b.x,a.z-b.z); if (i!==from && b.owner!==a.owner && d<distance) {to=i;distance=d;} });
    if (to>=0 && sim.canDraw(a.owner,from,to)===null) commands.push({type:'DrawLine',player:a.owner,from,to});
  });
  for(let t=0;t<45;t++) {
    const events=sim.step(t===0?commands:[],{events:true});
    stage.update({view:sim.view,troops,n:sim.readTroops(troops),alpha:.5,towerRadiusMilli:sim.towerRadiusMilli},events,50);
  }
  await new Promise(resolve => { let quiet=0; const check=()=> {quiet=THREE.DefaultLoadingManager.isLoading?0:quiet+1;quiet>20?resolve():requestAnimationFrame(check);};check(); });
  stage.render();
  window.__frame = {stage,level,sim,canvas:stage.canvas,scene:stage.scene,worldRoot:stage.worldRoot};
};
