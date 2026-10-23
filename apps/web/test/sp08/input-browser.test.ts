import { expect, it } from 'vitest';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

it('submits draw and swipe-cut commands from real browser pointer events under the single mirror', async () => {
  const server=await createServer({configFile:false,root:process.cwd(),optimizeDeps:{noDiscovery:true,include:[]},server:{host:'127.0.0.1',port:0},plugins:[{name:'input-test-page',configureServer(s){s.middlewares.use('/__input',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<canvas width="1000" height="1000" style="width:1000px;height:1000px;position:absolute;left:0;top:0"></canvas>');});}}]});
  await server.listen(); const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1000,height:1000}});await page.goto(`${server.resolvedUrls!.local[0]}__input`);
    const points=await page.evaluate(async()=>{
      const load=new Function('url','return import(url)');
      const {createInputController}=await load('/src/input/index.ts');
      const {Group,PerspectiveCamera,Scene,Vector3}=await load('/node_modules/three/build/three.module.js');
      const camera=new PerspectiveCamera(45,1,.1,100);camera.position.set(0,10,12);camera.lookAt(0,0,0);camera.updateMatrixWorld();
      const root=new Group();root.scale.z=-1;root.updateMatrixWorld();const scene=new Scene();scene.add(root);
      const anchors=[new Vector3(-2,0,1),new Vector3(2,0,1)];
      const sim={view:{players:[{kind:'human',colorKey:'blue'}],ids:{buildings:['a','b']},buildings:{owner:[0,-1]},buildingStatic:[{drawsLines:true},{drawsLines:true}],lines:[{channel:1,owner:0,from:0,to:1}],over:null},canDraw:()=>null};
      const commands: unknown[]=[];Object.assign(window,{inputCommands:commands});
      createInputController({canvas:document.querySelector('canvas'),camera,sim,worldRoot:root,scene,world:{anchors:{building:(id:string)=>({pos:anchors[id==='a'?0:1],radius:.7})},pickMeshes:[],previewLane:()=>{},clearPreview:()=>{}},driver:{submit:(c:unknown)=>commands.push(c)}});
      return anchors.map((p: typeof Vector3)=>{p=p.clone().applyMatrix4(root.matrixWorld).project(camera);return {x:(p.x+1)*500,y:(1-p.y)*500};});
    });
    const a=points[0]!,b=points[1]!;await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});await page.mouse.up();
    const x=(a.x+b.x)/2;await page.mouse.move(x,a.y-100);await page.mouse.down();await page.mouse.move(x,a.y+100,{steps:5});await page.mouse.up();
    expect(await page.evaluate(()=>Reflect.get(window,'inputCommands'))).toEqual([{type:'DrawLine',player:0,from:0,to:1},{type:'CutLine',player:0,from:0,to:1}]);
  } finally {await browser.close();await server.close();}
},20000);
