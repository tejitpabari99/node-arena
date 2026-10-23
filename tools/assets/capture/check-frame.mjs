#!/usr/bin/env node
// SP08 camera/resize integration proof. Real WebGL world, no legacy shell imports.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)), root=path.resolve(here,'../../..');
const require=createRequire(path.join(root,'apps/web/package.json'));
const pw=await import(pathToFileURL(require.resolve('@playwright/test')).href);
const chromium=pw.chromium ?? pw.default.chromium;
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href);
const out=path.resolve(process.argv[2] ?? '/tmp/sp08-frame'); fs.mkdirSync(out,{recursive:true});
const server=await createServer({configFile:path.join(here,'vite.config.mjs'),logLevel:'warn',server:{port:4182,strictPort:true,host:'127.0.0.1'}});
await server.listen();
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:3});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:4182/?scene=l4-frame');
  await page.waitForFunction(()=>window.__sceneReady || window.__sceneError,null,{timeout:60000});
  assert.equal(await page.evaluate(()=>window.__sceneError),null);
  const results=[];
  for(const [width,height] of [[1280,720],[1600,900],[1920,1080],[1366,768],[2560,1080],[1024,768]]) {
    await page.setViewportSize({width,height});
    await page.waitForFunction(({width,height})=>{const f=window.__frame;return f.stage.renderer.getSize({set(x,y){this.x=x;this.y=y;return this;}}).x===width && f.stage.canvas.height===height*2;},{width,height});
    const result=await page.evaluate(()=>{
      const {stage,level,sim,canvas,scene,worldRoot}=window.__frame;
      const w=innerWidth,h=innerHeight,problems=[];
      if(stage.canvas!==canvas||stage.scene!==scene||stage.worldRoot!==worldRoot) problems.push('scene rebuilt');
      if(document.querySelectorAll('canvas').length!==1) problems.push('multiple canvases');
      if(worldRoot.scale.z!==-1||worldRoot.scale.x!==1) problems.push('root mirror');
      scene.updateMatrixWorld(true);
      const labels=scene.getObjectByName('world:labels');
      if(labels?.parent!==scene||labels.matrixWorld.determinant()<0) problems.push('labels mirrored');
      // Check every visible building mesh vertex, plus label corners. This catches anchor envelopes that are too small.
      const check=(p,name)=>{p.project(stage.camera);const x=(p.x+1)*w/2,y=(1-p.y)*h/2;if(x<36-.1||x>w-36+.1||y<104-.1||y>h-64+.1||Math.abs(p.z)>1) problems.push(`${name}: ${x},${y},${p.z}`);};
      for(const mesh of stage.world.pickMeshes) {
        const position=mesh.geometry.attributes.position;
        for(let i=0;i<position.count;i++) {const p=stage.camera.position.clone().fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld);check(p,mesh.name);}
      }
      for(const b of level.buildings) {
        const a=stage.world.anchors.building(b.id); const p=a.labelPos.clone().applyMatrix4(worldRoot.matrixWorld);
        for(const x of [-.6,.6]) for(const y of [-.6,.6]) check(p.clone().addScaledVector(stage.camera.up,y).add({x,y:0,z:0}),`label:${b.id}`);
      }
      stage.render();
      return {width:w,height:h,buildings:level.buildings.length,meshCount:stage.world.pickMeshes.length,dpr:stage.renderer.getPixelRatio(),tick:sim.view.tick,problems};
    });
    assert.deepEqual(result.problems,[],`${width}x${height}`);assert.equal(result.dpr,2);
    await page.screenshot({path:path.join(out,`l4-${width}x${height}.jpg`),type:'jpeg',quality:82,scale:'css'});
    if(width===1600) await page.screenshot({path:path.join(out,'l4-unit.png'),clip:{x:640,y:395,width:100,height:100}});
    results.push(result);console.log(JSON.stringify(result));
  }
  assert.deepEqual(errors,[]); fs.writeFileSync(path.join(out,'frame-check.json'),JSON.stringify(results,null,2)+'\n');
  await page.evaluate(()=>window.__frame.stage.dispose());
  assert.equal(await page.locator('canvas').count(),0);
} finally {await browser.close();await server.close();}
