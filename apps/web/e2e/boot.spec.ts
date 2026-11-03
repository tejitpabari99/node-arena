import { expect,test } from '@playwright/test';
import { defaultSave } from '../src/save/index.js';
const CURRENT_SAVE_VERSION=defaultSave().v;
const development=process.env.WEB_TEST_SERVER==='dev';
test('fresh profile boots to main menu; Campaign shows 20 cards with only the first unlocked',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/?test=1');
 await expect(page.getByRole('heading',{name:'Choose your battle'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Custom',exact:true})).toHaveCount(development?1:0); // Custom is local-development only
 await expect(page.locator('.menu-stack .menu-tile').first()).toHaveText('Campaign');
 await page.getByRole('button',{name:'Campaign',exact:true}).click();
 await expect(page.locator('.level-grid.campaign .level-card')).toHaveCount(20);await expect(page.locator('.level-grid.campaign .level-card:not(:disabled)')).toHaveCount(1);
 expect(await page.locator('.level-grid.campaign .level-card > span').allTextContents()).toEqual(Array.from({length:20},(_,i)=>String(i+1)));
 await page.locator('.level-grid.campaign .level-card').first().click();await expect(page.locator('#game-hud')).toBeVisible();
 expect(errors).toEqual([]);
});
test('save with a non-current version is discarded, backed up and never unlocks the campaign',async({page})=>{
 const foreign=CURRENT_SAVE_VERSION+1;
 await page.addInitScript(([v])=>localStorage.setItem('nodearena:save',JSON.stringify({v,completed:{old:{firstAt:'2026-01-01'}},lastLevel:'old',settings:{}})),[foreign]);
 await page.goto('/?test=1');await page.getByRole('button',{name:'Campaign',exact:true}).click();await expect(page.locator('.level-grid.campaign .level-card')).toHaveCount(20);
 await expect(page.locator('.level-grid.campaign .level-card:not(:disabled)')).toHaveCount(1);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('nodearena:save')!).v)).toBe(CURRENT_SAVE_VERSION);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('nodearena:save.bak')!).v)).toBe(foreign);
});

test('production build has no Custom entry, even via ?view=custom',async({page})=>{
 test.skip(development,'Custom exists in development');
 await page.goto('/?test=1&view=custom');
 await expect(page.getByRole('heading',{name:'Choose your battle'})).toBeVisible();
 await expect(page.getByRole('button',{name:/^Custom/})).toHaveCount(0);
 await expect(page.getByText(/Custom levels?/)).toHaveCount(0);
 await expect(page.locator('.level-grid.custom')).toHaveCount(0);
});
test('development main menu stacks full-width tiles; custom cards show a thumbnail or placeholder, not the name',async({page})=>{
 test.skip(!development,'Custom is development-only');
 await page.goto('/?test=1');
 const tiles=page.locator('.menu-stack .menu-tile');await expect(tiles.first()).toBeVisible();expect((await tiles.allTextContents()).slice(0,2)).toEqual(['Campaign','Custom']);
 const boxes=await tiles.evaluateAll(e=>e.map(x=>{const r=x.getBoundingClientRect();return{x:r.x,w:r.width,y:r.y,h:r.height};}));
 expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y+boxes[0]!.h-1);expect(boxes[1]!.x).toBe(boxes[0]!.x);expect(boxes[0]!.w).toBeGreaterThan(400);
 await page.getByRole('button',{name:'Custom',exact:true}).click();
 const card=page.locator('.level-grid.custom .level-card[data-level-id]').first();await expect(card).toBeVisible();
 await expect(card.locator('.level-thumb')).toHaveCount(1); // img once rendered, placeholder if WebGL is unavailable
 await expect(card).toHaveAttribute('aria-label',/\S/);
 const label=(await card.getAttribute('aria-label'))!;
 expect((await card.innerText()).includes(label)).toBe(false);
 const img=card.locator('img.level-thumb');
 if(await img.count())await expect(img).toHaveAttribute('alt','');
});
