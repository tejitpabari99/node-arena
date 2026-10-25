import { it,expect } from 'vitest';
import { chromium,expect as browserExpect } from '@playwright/test';
import { createServer } from 'vite';
it('renders optional custom section and keeps campaign/custom result navigation separate',async()=>{
  const server=await createServer({cacheDir:'node_modules/.vite-test-custom',server:{host:'127.0.0.1',port:0},plugins:[{name:'custom-fixture',configureServer(s){s.middlewares.use('/__custom',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__custom','<!doctype html><html><body><main id="app"></main><script type="module" src="/test/sp08/custom-fixture.tsx"></script></body></html>'));});}}]});
  await server.listen();
  // Fixture plugin sets differ: isolate optimizer output and finish cold compilation before interaction timers.
  await server.warmupRequest('/test/sp08/custom-fixture.tsx');await server.waitForRequestsIdle();
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(5000);
    const url=server.resolvedUrls!.local[0]+'__custom';
    const openCustom=async()=>{await page.getByRole('button',{name:'Custom',exact:true}).click();};
    await page.goto(url);await browserExpect(page.getByRole('button',{name:'Campaign',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Campaign',exact:true}).click();await browserExpect(page.locator('.level-grid.campaign .level-card')).toHaveCount(20);
    await browserExpect(page.locator('.level-edit')).toHaveCount(0);await page.getByRole('button',{name:'Back',exact:true}).click();
    await page.goto(url+'?custom=1');await openCustom();
    const custom=page.locator('.level-grid.custom .level-card[data-level-id]');await browserExpect(custom).toHaveCount(2);
    expect(await custom.locator('span').allTextContents()).toEqual(['First custom battle','Last custom battle']);
    await browserExpect(custom.nth(1)).toBeEnabled();await custom.first().click();
    await browserExpect(page.locator('.battle-level')).toHaveText('First custom battle');
    await page.evaluate(()=>Reflect.get(window,'customTest').step());await browserExpect(page.getByRole('heading',{name:'Victory!'})).toBeVisible();
    await browserExpect(page.getByRole('button',{name:'Next level',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Levels',exact:true}).click();await browserExpect(page.locator('.level-grid.custom')).toBeVisible();await browserExpect(custom.first()).toBeFocused();
    await custom.nth(1).click();await browserExpect(page.locator('.battle-level')).toHaveText('Last custom battle');
    await page.evaluate(()=>Reflect.get(window,'customTest').step());await browserExpect(page.getByRole('button',{name:'Replay',exact:true})).toBeVisible();
    await browserExpect(page.getByRole('button',{name:'Next level',exact:true})).toHaveCount(0);await browserExpect(page.getByRole('heading',{name:'All levels complete!'})).toHaveCount(0);
    await page.getByRole('button',{name:'Levels',exact:true}).click();await browserExpect(custom.nth(1)).toBeFocused();
    await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByRole('button',{name:'Campaign',exact:true}).click();
    await browserExpect(page.locator('.level-grid.campaign .level-card:not(:disabled)')).toHaveCount(1);expect(errors).toEqual([]);
  }finally{await browser.close();await server.close();}
},30000);
