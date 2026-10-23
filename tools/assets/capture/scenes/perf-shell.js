// Measurement-only public SimView adapter. Actual controller, Preact HUD and SP08 level scene;
// synthetic SP07 population isolates presentation cost from simulation/bot performance.
import * as THREE from 'three';
import { ownership } from '../../../../apps/web/src/ui/ownership.ts';
import manifest from '../../../../apps/web/assets/manifest.json';
import { create } from '@node-arena/sim';
import { contentFiles } from '../../../../apps/web/src/app/boot.ts';
import { createAppController } from '../../../../apps/web/src/app/state.ts';
import { createLevelScene } from '../../../../apps/web/src/render/scene.ts';
import { mountApp } from '../../../../apps/web/src/ui/App.tsx';
import '../../../../apps/web/src/style.css';
import { createPerfFixture } from './perf.js';

const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
export default async function perfShell({canvas}) {
  canvas.remove();
  const arena = document.createElement('div'); arena.id='arena'; document.body.append(arena);
  const root = document.createElement('main'); root.id='app'; document.body.append(root);
  const {level,frame} = createPerfFixture();
  let stage;
  const app = createAppController({files:contentFiles(),autoStart:false,loadManifest:async()=>manifest,
    createBotDriver:()=>({commands:()=>[]}),
    createSim:(compiled,seed)=>({...create(compiled,seed),view:frame.view,step:()=>{frame.view.tick++;return [];}}),
    createRuntime:async()=>{
      stage=createLevelScene({level,view:frame.view,manifest,parent:arena,worldOptions:{baseURL:__WEB_ASSETS__}});
      await stage.ready;
      return {frame(){},tick(){},refresh(){},cancel:()=>false,dispose:()=>stage.dispose()};
    },
  });
  mountApp(app,root);await app.boot();await app.startLevel(app.snapshot().levels[0].id);
  stage.update(frame,[],0);stage.render();
  await new Promise(resolve=>{let quiet=0;const tick=()=>{quiet=THREE.DefaultLoadingManager.isLoading?0:quiet+1;quiet>20?resolve():requestAnimationFrame(tick);};tick();});
  stage.update(frame,[],0);stage.render();await document.fonts.ready;
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  // Include controller tick/publication, ownership math, and Preact's async DOM commit.
  // Rendering stays independent; this loop never gates the measured canvas frame loop.
  const hudSamples=[];
  const batchSize=10;
  for(let batch=0;batch<240;batch++){
    const start=performance.now();
    for(let i=0;i<batchSize;i++){
      frame.view.buildings.level[0]=i%2?12:48;app.step(2);
      await Promise.resolve();await Promise.resolve();
      if(Number(root.querySelector('[data-ownership-player]').dataset.permille)!==ownership(frame.view)[0].permille)throw Error('HUD did not commit the changed ownership before measurement');
    }
    if(batch>=40)hudSamples.push((performance.now()-start)/batchSize);
  }
  const widths=[...root.querySelectorAll('[data-ownership-player]')].map(n=>Number(n.dataset.permille));
  if(widths.length!==4||widths.reduce((a,b)=>a+b,0)!==1000)throw Error('Actual four-colour HUD did not commit');
  const gl=stage.renderer.getContext(),pixel=new Uint8Array(4);
  const step=()=>{
    for(let i=0;i<frame.n;i++)frame.troops.progress[i]=(frame.troops.progress[i]+frame.troops.speed[i])%frame.troops.laneLength[i];
    stage.update(frame,[],16.7);stage.render();
    gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
  };
  for(let i=0;i<5;i++)step();
  const frameSamples=[],updateSamples=[];
  for(let i=0;i<20;i++){const start=performance.now();step();frameSamples.push(performance.now()-start);}
  for(let i=0;i<100;i++){const start=performance.now();stage.update(frame,[],16.7);updateSamples.push(performance.now()-start);}
  stage.render();
  let unitDraws=0;stage.scene.traverse(o=>{if(o.isInstancedMesh&&o.visible&&o.count>0)unitDraws++;});
  const debug=gl.getExtension('WEBGL_debug_renderer_info');
  const result={population:'synthetic public SimView / SP07 perf layout',shell:'createAppController + createLevelScene + mountApp/Hud',
    renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
    viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},troops:frame.n,buildings:level.buildings.length,lines:frame.view.lines.length,
    drawCalls:stage.renderer.info.render.calls,unitDrawCalls:unitDraws,triangles:stage.renderer.info.render.triangles,
    hud:{warmupUpdates:40*batchSize,batches:hudSamples.length,updatesPerBatch:batchSize,samples:hudSamples.length*batchSize,medianMs:median(hudSamples),maxMs:Math.max(...hudSamples),includes:'two public ticks + snapshot publication + ownership + asynchronous Preact DOM commit + committed ownership assertion; per-update batched time, excludes canvas'},
    softwareFrames:{warmup:5,samples:frameSamples.length,medianMs:median(frameSamples),meanMs:frameSamples.reduce((a,b)=>a+b,0)/frameSamples.length,includes:'world update + render + synchronous readPixels GPU completion'},
    worldUpdate:{samples:updateSamples.length,medianMs:median(updateSamples)},ownershipPermille:widths,
  };
  if(result.hud.medianMs>=1)throw Error(`HUD budget exceeded: ${result.hud.medianMs} ms`);
  if(result.triangles>300000)throw Error(`Triangle budget exceeded: ${result.triangles}`);
  window.__perfResult=result;console.log('perf-shell: '+JSON.stringify(result));
}
