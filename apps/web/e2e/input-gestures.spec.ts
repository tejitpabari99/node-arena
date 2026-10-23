import { expect,test } from '@playwright/test';
import { draw,openLevel } from './helpers';
for(const mode of ['swipe','right button','eraser'] as const)test(`${mode} cuts each own line once through driver.submit`,async({page})=>{
 await openLevel(page);const p=await draw(page),mx=(p.a.x+p.b.x)/2,my=(p.a.y+p.b.y)/2;
 const dx=p.b.x-p.a.x,dy=p.b.y-p.a.y,len=Math.hypot(dx,dy),ox=-dy/len*60,oy=dx/len*60;
 await page.mouse.move(mx+ox,my+oy);await page.mouse.down({button:mode==='right button'?'right':'left'});
 if(mode==='eraser'){await page.waitForTimeout(750);await page.evaluate(()=>window.__na!.render());await expect(page.locator('#arena canvas')).toHaveCSS('cursor','crosshair');}
 await page.mouse.move(mx-ox,my-oy,{steps:8});await page.mouse.move(mx+ox,my+oy,{steps:8});await page.mouse.up({button:mode==='right button'?'right':'left'});await page.evaluate(()=>window.__na!.step());
 expect(await page.evaluate(()=>window.__na!.commandLog.filter(s=>s.cmd.type==='CutLine'))).toEqual([{tick:1,cmd:{type:'CutLine',player:p.player,from:p.from,to:p.to}}]);
});
