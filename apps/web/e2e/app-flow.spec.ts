import { expect,test } from '@playwright/test';
import { draw,openLevel } from './helpers';
test('valid driver command wins, unlocks next, Next loads second battle and Replay resets it',async({page})=>{
 await openLevel(page,1,'win');await draw(page);
 await expect(page.getByRole('dialog',{name:'Victory!'})).toBeVisible();
 expect(await page.evaluate(()=>Object.keys(window.__na!.state().save.completed))).toHaveLength(1);
 await page.getByRole('button',{name:'Next level',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__na!.state().levelId)).toBe(await page.evaluate(()=>window.__na!.state().levels[1]!.id));
 await draw(page);await page.getByRole('button',{name:'Replay',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__na!.screen)).toBe('playing');
 expect(await page.evaluate(()=>window.__na!.view!.tick)).toBe(0);expect(await page.evaluate(()=>window.__na!.commandLog)).toEqual([]);
});
test('valid command triggers defeat and Retry resets without recording completion',async({page})=>{
 await openLevel(page,1,'loss');await draw(page);await expect(page.getByRole('dialog',{name:'Defeat',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.__na!.state().save.completed)).toEqual({});
 await page.getByRole('button',{name:'Retry',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__na!.screen)).toBe('playing');
 expect(await page.evaluate(()=>window.__na!.view!.tick)).toBe(0);expect(await page.evaluate(()=>window.__na!.commandLog)).toEqual([]);
});
test('picker progress and last played focus persist on real storage reload',async({page})=>{
 await page.goto('/?test=1');await expect(page.locator('.level-grid.campaign .level-card')).toHaveCount(20);
 const ids=await page.evaluate(()=>window.__na!.state().levels.map(l=>l.id));
 // Seed a genuine v2 persisted win record; the unit/controller tests cover recordResult persistence.
 await page.evaluate(id=>{const state=window.__na!.state().save;state.completed[id]={firstAt:'2026-10-23T00:00:00.000Z'};state.lastLevel=id;localStorage.setItem('nodearena:save',JSON.stringify(state));},ids[0]!);
 await page.reload();await expect(page.locator('.level-grid.campaign .level-card[data-state="completed"]')).toHaveCount(1);
 await expect(page.locator('.level-grid.campaign .level-card:not(:disabled)')).toHaveCount(2);
 await expect(page.locator('.level-grid.campaign .level-card').first()).toBeFocused();
});
