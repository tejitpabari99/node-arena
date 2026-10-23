import { expect,test } from '@playwright/test';
import { openLevel } from './helpers';
test('all 20 campaign levels keep building anchors and labels inside HUD-safe frame at five window sizes',async({page})=>{
 test.setTimeout(180000);await openLevel(page,20);
 const sizes=[{width:1280,height:720},{width:1600,height:900},{width:1920,height:1080},{width:1366,height:768},{width:2560,height:1080}];
 for(let level=1;level<=20;level++){
  await page.evaluate(n=>window.__na!.load(n),level);
  for(const size of sizes){await page.setViewportSize(size);await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__na!.render();r();}))));
   const probe=await page.evaluate(()=>window.__na!.visualProbe());expect(probe.buildings.length).toBeGreaterThan(0);
   for(const building of probe.buildings){
    const model=Reflect.get(building,'modelRect'),label=Reflect.get(building,'labelRect');
    expect(model,`level ${level} ${building.id} visible mesh bounds`).toBeTruthy();expect(label,`level ${level} ${building.id} billboard bounds`).toBeTruthy();
    for(const rect of [model,label]){if(!rect)throw Error('Missing visible geometry');expect(rect.x).toBeGreaterThanOrEqual(36);expect(rect.x+rect.w).toBeLessThanOrEqual(size.width-36);expect(rect.y).toBeGreaterThanOrEqual(104);expect(rect.y+rect.h).toBeLessThanOrEqual(size.height-64);}
    for(const point of [building.point,building.label]){
    expect(point.x,`level ${level} ${size.width} ${building.id} x`).toBeGreaterThanOrEqual(36);
    expect(point.x).toBeLessThanOrEqual(size.width-36);expect(point.y).toBeGreaterThanOrEqual(104);expect(point.y).toBeLessThanOrEqual(size.height-64);
   }}
  }
 }
});
