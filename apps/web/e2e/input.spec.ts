import { expect,test } from '@playwright/test';
import { draw,legalPair,openLevel } from './helpers';
test('mouse draw submits a tick stamped command through the real driver',async({page})=>{await openLevel(page);const pair=await draw(page);expect(await page.evaluate(()=>window.__na!.visualProbe().lines)).toEqual(expect.arrayContaining([expect.objectContaining({from:pair.from,to:pair.to,owner:pair.player})]));});
test('Esc cancels a pending draw without submitting any command',async({page})=>{
 await openLevel(page);const p=await legalPair(page);await page.mouse.move(p.a.x,p.a.y);await page.mouse.down();await page.mouse.move(p.b.x,p.b.y,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();await page.evaluate(()=>window.__na!.step());
 expect(await page.evaluate(()=>window.__na!.commandLog.filter(s=>s.cmd.player===0))).toEqual([]);
});
test('blocked obstacle drag shows a reason and blocker, and release sends no command',async({page})=>{
 await openLevel(page,20);
 const pair=await page.evaluate(async()=>{
  const api=window.__na!;
  for(let level=20;level>=1;level--){await api.load(level);await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));const v=api.view!,buildings=api.visualProbe().buildings,human=0;
   for(let from=0;from<buildings.length;from++)for(let to=0;to<buildings.length;to++){
    const legality=api.legality(from,to);if(v.buildings.owner[from]===human&&legality.reason==='blocked-obstacle'&&legality.explanation)
      return {a:api.project(buildings[from]!.id),b:api.project(buildings[to]!.id),human};
   }
  }throw Error('Campaign lacks an obstacle-blocked route');
 });
 await page.mouse.move(pair.a.x,pair.a.y);await page.mouse.down();await page.mouse.move(pair.b.x,pair.b.y,{steps:8});
 await expect(page.locator('[data-input-feedback="reason"]')).toHaveText('An obstacle blocks this route.');await expect(page.locator('[data-input-feedback="blocker"]')).toBeVisible();await expect(page.locator('[data-input-feedback="blocker"]')).toHaveCSS('border-top-color','rgb(255, 57, 77)');
 await page.mouse.up();await page.evaluate(()=>window.__na!.step());expect(await page.evaluate(h=>window.__na!.commandLog.filter(s=>s.cmd.player===h),pair.human)).toEqual([]);
});
