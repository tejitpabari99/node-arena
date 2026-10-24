import { expect,test } from '@playwright/test';
test('fresh profile boots directly to 20 campaign cards with only the first unlocked',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/?test=1');
 await expect(page.getByRole('heading',{name:'Choose your battle'})).toBeVisible();
 await expect(page.locator('.level-grid.campaign .level-card')).toHaveCount(20);await expect(page.locator('.level-grid.campaign .level-card:not(:disabled)')).toHaveCount(1);
 expect(await page.locator('.level-grid.campaign .level-card > span').allTextContents()).toEqual(Array.from({length:20},(_,i)=>String(i+1)));
 await page.locator('.level-grid.campaign .level-card').first().click();await expect(page.locator('#game-hud')).toBeVisible();
 expect(errors).toEqual([]);
});
test('v1 save is discarded, backed up and never unlocks the v2 campaign',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('nodearena:save',JSON.stringify({v:1,completed:{old:{firstAt:'2026-01-01'}},lastLevel:'old',settings:{}})));
 await page.goto('/?test=1');await expect(page.locator('.level-grid.campaign .level-card')).toHaveCount(20);
 await expect(page.locator('.level-grid.campaign .level-card:not(:disabled)')).toHaveCount(1);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('nodearena:save')!).v)).toBe(2);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('nodearena:save.bak')!).v)).toBe(1);
});
