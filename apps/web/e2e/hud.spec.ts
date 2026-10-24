import { expect,test } from '@playwright/test';
import { draw,openLevel } from './helpers';
test('Pause button opens Paused menu; Resume resumes; Restart clears commands and Levels opens picker',async({page})=>{
 await openLevel(page);await draw(page);await page.getByRole('button',{name:'Pause'}).click();
 await expect(page.getByRole('dialog')).toHaveAccessibleName('Paused');
 expect(await page.evaluate(()=>window.__na!.step(20))).toBe(0);
 await page.getByRole('button',{name:'Resume',exact:true}).click();expect(await page.evaluate(()=>window.__na!.step())).toBe(1);
 await page.getByRole('button',{name:'Pause'}).click();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:'Pause'}).click();await page.getByRole('button',{name:'Restart',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__na!.view?.tick)).toBe(0);expect(await page.evaluate(()=>window.__na!.commandLog)).toEqual([]);
 await page.getByRole('button',{name:'Pause'}).click();await page.getByRole('button',{name:'Levels',exact:true}).click();await expect(page.locator('.level-card')).toHaveCount(20);
});
test('ownership uses building levels rather than in-flight units and updates after a real capture',async({page})=>{
 await openLevel(page);await draw(page);
 for(let i=0;i<20;i++) {if(await page.evaluate(()=>window.__na!.events.some(e=>e.type==='BuildingCaptured')))break;await page.evaluate(()=>window.__na!.step(100));}
 expect(await page.evaluate(()=>window.__na!.events.some(e=>e.type==='BuildingCaptured'))).toBe(true);
 const expected=await page.evaluate(()=>{const api=window.__na!,v=api.view!,segments=api.hud().ownership,totals=segments.map(({player:p})=>Array.from(v.buildings.owner).reduce((sum,owner,i)=>sum+(owner===p?v.buildings.level[i]!:0),0)),total=totals.reduce((a,b)=>a+b,0);let assigned=0;return totals.map((n,p)=>({n,p})).filter(s=>s.n>0).map((s,i,a)=>{const permille=i===a.length-1?1000-assigned:Math.floor(s.n*1000/total);assigned+=permille;return {player:segments[s.p]!.player,colorKey:segments[s.p]!.colorKey,permille};});});
 expect(await page.evaluate(()=>window.__na!.hud().ownership)).toEqual(expected);
 for(const s of expected)await expect(page.locator(`[data-ownership-player="${s.player}"]`)).toHaveAttribute('data-permille',String(s.permille));
});
test('four-colour campaign battle shows four segments and only back/zoom/mute controls',async({page})=>{
 await openLevel(page,20);const number=await page.evaluate(()=>{const api=window.__na!;return api.state().levels.length;});
 let found=false;for(let i=number;i>=1;i--){await page.evaluate(n=>window.__na!.load(n),i);if(await page.locator('[data-ownership-player]').count()===4){found=true;break;}}
 expect(found).toBe(true);await expect(page.locator('#game-hud button')).toHaveCount(3);
 await page.getByRole('button',{name:'Mute sound'}).click();await expect(page.getByRole('button',{name:'Unmute sound'})).toHaveAttribute('aria-pressed','true');
});
test('zoom button toggles Zoom in / Zoom out, keeps zoom across restart, and lines can still be drawn zoomed',async({page})=>{
 await openLevel(page);
 const spread=()=>page.evaluate(()=>{const api=window.__na!,b=api.visualProbe().buildings.map(x=>api.project(x.id));const xs=b.map(p=>p.x);return Math.max(...xs)-Math.min(...xs);});
 const near=await spread();
 await page.getByRole('button',{name:'Zoom in'}).click();
 await expect(page.getByRole('button',{name:'Zoom out'})).toBeVisible();
 expect(await spread()).toBeGreaterThan(near*1.1);
 await draw(page);
 await page.getByRole('button',{name:'Pause'}).click();await page.getByRole('button',{name:'Restart',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__na!.view?.tick)).toBe(0);
 await expect(page.getByRole('button',{name:'Zoom out'})).toBeVisible();
 await page.getByRole('button',{name:'Zoom out'}).click();
 await expect(page.getByRole('button',{name:'Zoom in'})).toBeVisible();
 expect(Math.abs(await spread()-near)).toBeLessThan(2);
});

test('no focus ring on pause/zoom buttons after Escape-close or on load',async({page})=>{
 await openLevel(page);
 const ring=()=>page.evaluate(()=>({active:document.activeElement?.className??'',visible:Array.from(document.querySelectorAll('.battle-back,.battle-zoom')).filter(b=>b.matches(':focus-visible')).length}));
 expect(await ring()).toMatchObject({visible:0});
 await page.getByRole('button',{name:'Pause'}).click();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 const after=await ring();expect(after.visible).toBe(0);expect(after.active).not.toContain('battle-back');
 await page.getByRole('button',{name:'Pause'}).click();await page.getByRole('button',{name:'Resume',exact:true}).click();
 expect(await ring()).toMatchObject({visible:0});
});
