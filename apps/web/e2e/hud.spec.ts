import { expect,test } from '@playwright/test';
import { draw,openLevel } from './helpers';
test('Back pauses with restart popup; Continue resumes; Restart clears commands and Levels opens picker',async({page})=>{
 await openLevel(page);await draw(page);await page.getByRole('button',{name:'Back to battle options'}).click();
 await expect(page.getByRole('dialog')).toHaveAccessibleName('Do you want to restart the battle?');
 expect(await page.evaluate(()=>window.__na!.step(20))).toBe(0);
 await page.getByRole('button',{name:'Continue',exact:true}).click();expect(await page.evaluate(()=>window.__na!.step())).toBe(1);
 await page.getByRole('button',{name:'Back to battle options'}).click();await page.getByRole('button',{name:'Restart',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__na!.view?.tick)).toBe(0);expect(await page.evaluate(()=>window.__na!.commandLog)).toEqual([]);
 await page.getByRole('button',{name:'Back to battle options'}).click();await page.getByRole('button',{name:'Levels',exact:true}).click();await expect(page.locator('.level-card')).toHaveCount(20);
});
test('ownership uses building levels rather than in-flight units and updates after a real capture',async({page})=>{
 await openLevel(page);await draw(page);
 for(let i=0;i<20;i++) {if(await page.evaluate(()=>window.__na!.events.some(e=>e.type==='BuildingCaptured')))break;await page.evaluate(()=>window.__na!.step(100));}
 expect(await page.evaluate(()=>window.__na!.events.some(e=>e.type==='BuildingCaptured'))).toBe(true);
 const expected=await page.evaluate(()=>{const api=window.__na!,v=api.view!,segments=api.hud().ownership,totals=segments.map(({player:p})=>Array.from(v.buildings.owner).reduce((sum,owner,i)=>sum+(owner===p?v.buildings.level[i]!:0),0)),total=totals.reduce((a,b)=>a+b,0);let assigned=0;return totals.map((n,p)=>({n,p})).filter(s=>s.n>0).map((s,i,a)=>{const permille=i===a.length-1?1000-assigned:Math.floor(s.n*1000/total);assigned+=permille;return {player:segments[s.p]!.player,colorKey:segments[s.p]!.colorKey,permille};});});
 expect(await page.evaluate(()=>window.__na!.hud().ownership)).toEqual(expected);
 for(const s of expected)await expect(page.locator(`[data-ownership-player="${s.player}"]`)).toHaveAttribute('data-permille',String(s.permille));
});
test('four-colour campaign battle shows four segments and only back/mute controls',async({page})=>{
 await openLevel(page,20);const number=await page.evaluate(()=>{const api=window.__na!;return api.state().levels.length;});
 let found=false;for(let i=number;i>=1;i--){await page.evaluate(n=>window.__na!.load(n),i);if(await page.locator('[data-ownership-player]').count()===4){found=true;break;}}
 expect(found).toBe(true);await expect(page.locator('#game-hud button')).toHaveCount(2);
 await page.getByRole('button',{name:'Mute sound'}).click();await expect(page.getByRole('button',{name:'Unmute sound'})).toHaveAttribute('aria-pressed','true');
});
