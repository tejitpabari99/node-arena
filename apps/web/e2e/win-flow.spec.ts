import { expect,test } from '@playwright/test';
import { openLevel } from './helpers';
// Winning plan for levelview-4 (UI "Level 4"), seed 1, recorded from the human-proxy bot (see test/win-flow.test.ts).
const plan=[[40,0,3],[81,0,5],[245,3,1],[286,5,1],[327,1,4],[368,4,2]] as const;
test('levelview-4 real win shows Victory popup and marks completed',async({page})=>{
 test.setTimeout(90000);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
 await openLevel(page,4);
 expect(await page.evaluate(()=>window.__na!.state().levelId)).toBe('levelview-4');
 for(const [tick,from,to] of plan){
  await page.evaluate(t=>{const a=window.__na!;a.step(t-a.hud().tick!);},tick);
  await page.evaluate(([f,t])=>window.__na!.submit({type:'DrawLine',player:0,from:f!,to:t!}),[from,to]);
 }
 await page.evaluate(()=>{const a=window.__na!;for(let i=0;i<40&&a.screen==='playing';i++)a.step(20);});
 await expect(page.getByRole('dialog',{name:'Victory!'})).toBeVisible();
 expect(await page.evaluate(()=>window.__na!.state().result)).toEqual({outcome:'won',winner:0});
 expect(await page.evaluate(()=>Object.keys(window.__na!.state().save.completed))).toContain('levelview-4');
 await expect(page.locator('.picker')).toHaveCount(0);
 expect(errors).toEqual([]);
});
