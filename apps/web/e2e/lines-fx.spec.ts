import { fileURLToPath } from 'node:url';
const publicSimPath = `/@fs${fileURLToPath(new URL('../../../packages/sim/src/index.ts', import.meta.url))}`;
import { expect, test } from '@playwright/test';
test('real sim opposite ribbons, clash event coordinates, capture effects, scrolling shader and GPU cleanup', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Module harness until Task12 wiring');
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  const result = await page.evaluate(async (simPath) => {
    const linePath='/src/render/lines.ts',fxPath='/src/render/fx.ts',scopePath='/src/render/disposables.ts',threePath='/node_modules/.vite/deps/three.js';
    const {createLineRenderer}=await import(linePath),{createFxRenderer}=await import(fxPath),{Disposables}=await import(scopePath),{create}=await import(simPath);
    const {Scene,PerspectiveCamera,WebGLRenderer,Vector3}=await import(threePath);
    const manifest=await(await fetch('/manifest.json')).json();manifest.events.Clash.fx='spark';
    const towerVisual=Object.entries(manifest.visuals).find(([,v]:any)=>v.kind==='tower')![0],troopVisual=Object.entries(manifest.visuals).find(([,v]:any)=>v.kind==='troop')![0];
    function level(capture=false){return {componentNames:['capturable','drawsLines','garrison','generates'],id:'fixture',timeLimitSec:1000,visual:Object.keys(manifest.themes)[0],bots:[],bounds:{w:10000,h:10000},
      players:[{id:'a',team:'a',kind:'human',colorKey:'player.1'},{id:'b',team:'b',kind:'bot',colorKey:'player.2'}],
      towers:[0,1].map(i=>({id:`t${i}`,x:i*10000,y:0,owner:i,garrison:capture&&i===1?0:100,archetype:'fixture',visual:towerVisual,footprintRadius:1000,
        components:{garrison:{cap:1000},generates:{troop:0,ratePerSec:capture&&i===1?0:20000},drawsLines:{extraSlotAbove:[]},capturable:{}}})),
      kinds:[{id:'fixture',value:1,speedMilli:20000,visual:troopVisual}]};}
    const sim=create(level(),4),scene=new Scene(),camera=new PerspectiveCamera(45,2,.1,100);camera.position.set(5,12,8);camera.lookAt(5,0,0);camera.updateMatrixWorld();
    const gl=new WebGLRenderer({antialias:false,preserveDrawingBuffer:true});gl.setSize(800,400);document.body.replaceChildren(gl.domElement);gl.render(scene,camera);const baseline={...gl.info.memory};
    const scope=new Disposables(),lines=createLineRenderer({view:sim.view,scene,scope,manifest}),fx=createFxRenderer({view:sim.view,scene,scope,manifest,capacity:8});
    const events=sim.step([{type:'DrawLine',player:'a',from:'t0',to:'t1'},{type:'DrawLine',player:'b',from:'t1',to:'t0'}]);lines.consumeEvents(events);const initialMeshes=[...lines.meshes];lines.update(0);gl.render(scene,camera);
    const pixels=new Uint8Array(800*400*4),ctx=gl.getContext();ctx.readPixels(0,0,800,400,ctx.RGBA,ctx.UNSIGNED_BYTE,pixels);
    let blue=0,red=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i+2]!>pixels[i]!+30)blue++;if(pixels[i]!>pixels[i+2]!+30)red++;}
    const before=new Uint8Array(pixels);lines.update(.25);gl.render(scene,camera);ctx.readPixels(0,0,800,400,ctx.RGBA,ctx.UNSIGNED_BYTE,pixels);let scrolling=0;for(let i=0;i<pixels.length;i++)if(pixels[i]!==before[i])scrolling++;
    let clash:any;for(let tick=0;tick<50&&!clash;tick++){const e=sim.step([]);clash=e.find((e:any)=>e.type==='Clash');lines.consumeEvents(e);if(clash)fx.consumeEvents([clash]);}
    fx.update(.1);gl.render(scene,camera);const clashPosition=fx.meshes.find((m:any)=>m.visible)?.position.toArray();
    const ndc=new Vector3(5,.15,0).project(camera),region=new Uint8Array(20*20*4);ctx.readPixels(Math.round((ndc.x+1)*400)-10,Math.round((ndc.y+1)*200)-10,20,20,ctx.RGBA,ctx.UNSIGNED_BYTE,region);const visibleSpark=new Uint8Array(region);for(const mesh of fx.meshes)mesh.visible=false;gl.render(scene,camera);ctx.readPixels(Math.round((ndc.x+1)*400)-10,Math.round((ndc.y+1)*200)-10,20,20,ctx.RGBA,ctx.UNSIGNED_BYTE,region);let sparkPixels=0;for(let i=0;i<region.length;i+=4)if(region[i]!==visibleSpark[i]||region[i+1]!==visibleSpark[i+1]||region[i+2]!==visibleSpark[i+2])sparkPixels++;
    const unchanged=lines.meshes.every((m:any,i:number)=>m===initialMeshes[i]);scope.dispose();gl.render(scene,camera);
    const captureSim=create(level(true),9),captureScope=new Disposables(),capture=createFxRenderer({view:captureSim.view,scene,scope:captureScope,manifest});let captured:any;
    let captureEvents=captureSim.step([{type:'DrawLine',player:'a',from:'t0',to:'t1'}]);for(let i=0;i<50&&!captured;i++){captureEvents=captureSim.step([]);captured=captureEvents.find((e:any)=>e.type==='Captured');}capture.consumeEvents(captureEvents);capture.update(.1);gl.render(scene,camera);
    const capturePosition=capture.meshes.find((m:any)=>m.visible)?.position.toArray(),captureEffect=capture.slots.find((s:any)=>s.active)?.effect;captureScope.dispose();gl.render(scene,camera);
    for(let i=0;i<20;i++){const s=new Disposables(),l=createLineRenderer({view:sim.view,scene,scope:s,manifest}),f=createFxRenderer({view:sim.view,scene,scope:s,manifest});f.consumeEvents([clash]);l.update(.3);gl.render(scene,camera);s.dispose();gl.render(scene,camera);}
    const after={...gl.info.memory};gl.dispose();return {blue,red,scrolling,unchanged,clash,clashPosition,sparkPixels,captured,capturePosition,captureEffect,baseline,after};
  }, publicSimPath);
  console.log(`LINES_FX_RESULT ${JSON.stringify(result)}`);
  expect(errors).toEqual([]);expect(result.blue).toBeGreaterThan(100);expect(result.red).toBeGreaterThan(100);expect(result.scrolling).toBeGreaterThan(100);expect(result.unchanged).toBe(true);
  expect(result.clash).toBeTruthy();expect(result.clashPosition![0]).toBe(result.clash.progA/20000);expect(result.clashPosition![0]).toBe(5);expect(result.sparkPixels).toBeGreaterThan(0);
  expect(result.captured).toBeTruthy();expect(result.capturePosition).toEqual([10,.12,0]);expect(result.captureEffect).toBe('pulse');expect(result.after).toEqual(result.baseline);
});
