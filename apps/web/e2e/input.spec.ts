import { expect, test, type Page } from '@playwright/test';

async function harness(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const paths = { input:'/src/input/index.ts',driver:'/src/driver/index.ts',lines:'/src/render/lines.ts',scope:'/src/render/disposables.ts',three:'/node_modules/.vite/deps/three.js' };
    const [{createInputController},{GameDriver},{createLineRenderer},{Disposables},{Scene,PerspectiveCamera,Vector3}] = await Promise.all([import(paths.input),import(paths.driver),import(paths.lines),import(paths.scope),import(paths.three)]);
    const manifest = await (await fetch('/manifest.json')).json();
    const level = { componentNames:['capturable','drawsLines','garrison','generates'],id:'input-fixture',timeLimitSec:100,visual:Object.keys(manifest.themes)[0],bots:[],bounds:{w:10000,h:10000},
      players:[{id:'human',team:'a',kind:'human',colorKey:'player.1'},{id:'other',team:'b',kind:'bot',colorKey:'player.2'}],
      towers:[[0,0],[10000,0],[5000,10000]].map(([x,y],i)=>({id:`t${i}`,x,y,owner:i===0?0:1,garrison:100,archetype:'fixture',visual:Object.keys(manifest.visuals).find(k=>manifest.visuals[k].kind==='tower'),footprintRadius:1000,
        components:{garrison:{cap:1000},generates:{troop:0,ratePerSec:i===0?20000:0},drawsLines:{extraSlotAbove:[]},capturable:{}}})),
      kinds:[{id:'fixture',value:1,speedMilli:20000,visual:Object.keys(manifest.visuals).find(k=>manifest.visuals[k].kind==='troop')}] };
    const scope=new Disposables(),scene=new Scene(),camera=new PerspectiveCamera(45,800/600,.1,100);
    camera.position.set(5,18,18);camera.lookAt(5,0,4);camera.updateMatrixWorld();
    const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=1200;canvas.style.cssText='position:fixed;left:20px;top:30px;width:800px;height:600px;touch-action:none';document.body.replaceChildren(canvas);
    const submissions:any[]=[],events:any[]=[];
    let input:any,lines:any;
    const driver=new GameDriver({level,matchSeed:9,autoStart:false,onTick:(update:any)=>{events.push(...update.events);lines.consumeEvents(update.events);input.refresh();}});
    lines=createLineRenderer({scene,manifest,scope,view:driver.sim.view});
    input=createInputController({canvas,sim:driver.sim,camera,scene,manifest,scope,lines,isEnabled:()=>!driver.paused,submit:(command:any)=>{const result=driver.submit(command);if(result)submissions.push(result);return result;}});
    function point(x:number,z:number){const p=new Vector3(x,0,z).project(camera),box=(canvas.isConnected?canvas:(window as any).inputHarness.replacement).getBoundingClientRect();return {x:box.left+(p.x+1)*box.width/2,y:box.top+(1-p.y)*box.height/2};}
    (window as any).inputHarness={input,driver,lines,scene,scope,submissions,events,point,get canvas(){return canvas;},
      center(){const segment=lines.projectSegments(camera,800,600).find((s:any)=>s.owner===0);const box=canvas.getBoundingClientRect();return {x:box.left+(segment.start.x+segment.end.x)/2,y:box.top+(segment.start.y+segment.end.y)/2};},
      info(){return {tick:driver.sim.tick,lines:driver.sim.view.lines.map((l:any)=>({...l})),submissions:[...submissions],events:[...events],reason:document.querySelector('[data-input-reason]')?.textContent,reasonVisible:(document.querySelector('[data-input-reason]') as HTMLElement)?.style.display!=='none',preview:scene.children.some((m:any)=>m.renderOrder===3&&m.isMesh&&m.visible),highlight:lines.meshes.some((m:any)=>m.material.uniforms.highlight.value===1)};}};
  });
}
const point = (page: Page,x:number,z:number) => page.evaluate(([x,z])=>(window as any).inputHarness.point(x,z),[x,z]);
const info = (page: Page) => page.evaluate(()=>(window as any).inputHarness.info());
async function draw(page: Page,to=1) {
  const a=await point(page,0,0),b=await point(page,to===1?10:5,to===1?0:10);
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});await page.mouse.up();
}
async function step(page: Page,n=1) { await page.evaluate(n=>(window as any).inputHarness.driver.step(n),n); }

test.beforeEach(async ({page})=>{test.skip(process.env.WEB_TEST_SERVER!=='dev','Module harness exercises real driver until production test hook supports fixture injection');await harness(page);});

test('draw snaps, queues next tick, explains duplicate/no-slot and Escape consumes active gesture',async ({page})=>{
  await draw(page);let state=await info(page);expect(state.tick).toBe(0);expect(state.lines).toHaveLength(0);expect(state.submissions).toEqual([{tick:0,cmd:{type:'DrawLine',player:'human',from:'t0',to:'t1'}}]);
  await step(page);state=await info(page);expect(state.lines).toHaveLength(1);expect(state.events.some((e:any)=>e.type==='LineDrawn')).toBe(true);
  const a=await point(page,0,0),b=await point(page,10,0),c=await point(page,5,10);
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y);state=await info(page);expect(state.reason).toBe('duplicate');expect(state.reasonVisible).toBe(true);expect(state.preview).toBe(true);
  // The app's Escape handler consumes cancel() before considering pause.
  expect(await page.evaluate(()=>(window as any).inputHarness.input.cancel())).toBe(true);expect(await page.evaluate(()=>(window as any).inputHarness.input.cancel())).toBe(false);await page.mouse.up();
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(c.x,c.y);expect((await info(page)).reason).toBe('no-slot');await page.mouse.up();expect((await info(page)).submissions).toHaveLength(1);
  await page.mouse.move(a.x,a.y);await page.mouse.down();const empty=await point(page,3,5);await page.mouse.move(empty.x,empty.y);await page.mouse.up();expect((await info(page)).submissions).toHaveLength(1);
});

test('right-click and contextmenu-only trackpad cut nearest own offset line; queued cut preserves arrivals',async ({page})=>{
  await draw(page);await step(page,3);
  // Real foreign opposite line exercises directed offset ownership filtering.
  await page.evaluate(()=>{const h=(window as any).inputHarness;h.driver.sim.step([{type:'DrawLine',player:'other',from:'t1',to:'t0'}]);h.lines.consumeEvents([{type:'LineDrawn'}]);});
  const center=await page.evaluate(()=>(window as any).inputHarness.center());await page.mouse.move(center.x,center.y);expect((await info(page)).highlight).toBe(true);
  await page.mouse.click(center.x,center.y,{button:'right'});let state=await info(page);expect(state.submissions.at(-1).cmd).toEqual({type:'CutLine',player:'human',from:'t0',to:'t1'});expect(state.lines).toHaveLength(2);
  await step(page,20);state=await info(page);expect(state.lines).toHaveLength(1);const cut=state.events.find((e:any)=>e.type==='LineCut'&&e.reason==='player');expect(cut).toBeTruthy();expect(state.events.some((e:any)=>e.type==='TroopSpawned'&&e.channel===1&&e.tick>=cut.tick)).toBe(false);expect(state.events.some((e:any)=>e.type==='TroopArrived'&&e.owner===0&&e.tick>cut.tick)).toBe(true);
  await draw(page);await step(page);const newCenter=await page.evaluate(()=>(window as any).inputHarness.center());
  const suppressed=await page.evaluate(p=>{const h=(window as any).inputHarness;return !h.canvas.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:p.x,clientY:p.y}));},newCenter);
  expect(suppressed).toBe(true);expect((await info(page)).submissions.filter((s:any)=>s.cmd.type==='CutLine')).toHaveLength(2);
});

test('empty-ground swipe cuts once per stroke, includes final segment and respects CSS tolerance',async ({page})=>{
  await draw(page);await step(page);const p=await page.evaluate(()=>(window as any).inputHarness.center());
  await page.mouse.move(p.x-30,p.y-30);await page.mouse.down();await page.mouse.move(p.x+30,p.y+30);await page.mouse.move(p.x-30,p.y-30);await page.mouse.move(p.x+30,p.y+30);await page.mouse.up();
  let state=await info(page);expect(state.submissions.filter((s:any)=>s.cmd.type==='CutLine')).toHaveLength(1);expect(state.lines).toHaveLength(1);await step(page);expect((await info(page)).lines).toHaveLength(0);
  await draw(page);await step(page);
  const center=await page.evaluate(()=>(window as any).inputHarness.center());await page.mouse.move(center.x-30,center.y+8.5);await page.mouse.down();await page.mouse.move(center.x+30,center.y+8.5);await page.mouse.up();state=await info(page);expect(state.submissions.filter((s:any)=>s.cmd.type==='CutLine')).toHaveLength(1);
  await page.mouse.move(center.x-30,center.y+7.5);await page.mouse.down();await page.mouse.move(center.x+30,center.y+7.5);await page.mouse.up();expect((await info(page)).submissions.filter((s:any)=>s.cmd.type==='CutLine')).toHaveLength(2);
});

test('paused/results ignore all gestures; pointer cancellation, canvas rebinding and disposal remove input',async ({page})=>{
  await draw(page);await step(page);const a=await point(page,0,0),b=await point(page,10,0),center=await page.evaluate(()=>(window as any).inputHarness.center());
  await page.mouse.move(a.x,a.y);await page.mouse.down();expect((await info(page)).preview).toBe(true);
  await page.evaluate(()=>{const h=(window as any).inputHarness;h.driver.pause();h.input.refresh();});expect((await info(page)).preview).toBe(false);await page.mouse.up();
  for(const blocked of ['paused','results']){
    if(blocked==='results')await page.evaluate(()=>{const h=(window as any).inputHarness;h.driver.resume();h.driver.step(2000);h.input.refresh();});
    const count=(await info(page)).submissions.length;await draw(page);await page.mouse.click(center.x,center.y,{button:'right'});await page.mouse.move(center.x-30,center.y-30);await page.mouse.down();await page.mouse.move(center.x+30,center.y+30);await page.mouse.up();expect((await info(page)).submissions).toHaveLength(count);
  }
  await page.evaluate(()=>{const h=(window as any).inputHarness;h.scope.dispose();h.input.dispose();});expect(await page.locator('[data-input-reason]').count()).toBe(0);
  expect(await page.evaluate(()=>(window as any).inputHarness.scene.children.length)).toBe(0);
});

test('12px right-click threshold, primary pointer cancellation and canvas replacement preserve one binding',async ({page})=>{
  await draw(page);await step(page);const a=await point(page,0,0),b=await point(page,10,0),center=await page.evaluate(()=>(window as any).inputHarness.center());
  await page.mouse.click(center.x,center.y+12.5,{button:'right'});expect((await info(page)).submissions).toHaveLength(1);
  await page.mouse.move(center.x,center.y+11.5);expect((await info(page)).highlight).toBe(true);
  await page.mouse.click(center.x,center.y+11.5,{button:'right'});expect((await info(page)).submissions.at(-1).cmd.type).toBe('CutLine');await step(page);
  for(const event of ['pointercancel','lostpointercapture']) {
    await page.mouse.move(a.x,a.y);await page.mouse.down();expect((await info(page)).preview).toBe(true);
    await page.evaluate(type=>{const h=(window as any).inputHarness;h.canvas.dispatchEvent(new PointerEvent(type,{pointerId:1,isPrimary:true}));},event);
    expect((await info(page)).preview).toBe(false);await page.mouse.move(b.x,b.y);await page.mouse.up();
  }
  expect((await info(page)).submissions).toHaveLength(2);
  await page.evaluate(()=>{const h=(window as any).inputHarness,newCanvas=h.canvas.cloneNode() as HTMLCanvasElement;h.canvas.replaceWith(newCanvas);h.input.setCanvas(newCanvas);h.input.setCanvas(newCanvas);h.replacement=newCanvas;});
  // The old canvas cannot enqueue commands; secondary pointers cannot begin a gesture.
  await page.evaluate(p=>{const h=(window as any).inputHarness;for(const target of [h.canvas,h.replacement]){target.dispatchEvent(new PointerEvent('pointerdown',{pointerId:7,isPrimary:false,button:0,clientX:p.x,clientY:p.y}));}h.canvas.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,isPrimary:true,button:0,clientX:p.x,clientY:p.y}));},a);
  expect((await info(page)).preview).toBe(false);
  await draw(page);expect((await info(page)).submissions).toHaveLength(3);expect((await info(page)).submissions.at(-1).cmd.type).toBe('DrawLine');await step(page);expect((await info(page)).lines).toHaveLength(1);
  await page.evaluate(()=>{const h=(window as any).inputHarness;h.input.dispose();});await draw(page);expect((await info(page)).submissions).toHaveLength(3);
});
