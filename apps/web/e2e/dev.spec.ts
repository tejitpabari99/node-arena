import { test, expect } from '@playwright/test';
import type { TestApi } from '../src/test-harness';
declare global { interface Window { __na?: TestApi } }
test('query gates live tuning; apply restarts and downloads actual authored JSON',async({page})=>{
  await page.goto('/'); await expect(page.getByRole('button',{name:'Play',exact:true})).toBeVisible();
  await expect(page.getByText('Live tuning',{exact:false})).toHaveCount(0);
  await page.goto('/?dev=1'); await expect(page.getByRole('button',{name:'Play',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await page.getByRole('button',{name:/1 Sample/}).click();
  await expect(page.locator('[data-tower-summary]')).toHaveCount(1); await expect(page.locator('[data-tower-index]')).toHaveCount(0);
  await page.locator('.dev-panel summary').click();
  const rate=page.getByRole('spinbutton',{name:'data/archetypes/standard.json/components/generates/ratePerSec',exact:true});
  await rate.fill('7');
  await page.getByRole('button',{name:'Apply and restart'}).click();
  await expect(page.getByRole('status').filter({hasText:'Tuned · completion disabled'})).toBeVisible();
  // The garrison ticks in real time and polling can skip any single value, so assert a threshold that only the
  // tuned rate (7/s) can reach from the sample start of 10 within the window; the old rate (1/s) tops out at ~20.
  await expect.poll(async()=>Number(((await page.locator('[data-tower-summary]').textContent())??'').match(/Tower t1(?:(?!Tower )[\s\S])*?Garrison (\d+)/)?.[1]??0),{timeout:10000}).toBeGreaterThanOrEqual(25);
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export JSON'}).click();
  const exported=await download;
  expect(exported.suggestedFilename()).toBe('data__archetypes__standard.json');
  const stream=await exported.createReadStream(); let text=''; for await(const chunk of stream!) text+=chunk.toString();
  expect(JSON.parse(text).components.generates.ratePerSec).toBe(7);
  await page.locator('.dev-panel summary').click();
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('checkbox',{name:'Colourblind palette'}).check();
  await expect(page.locator('[data-tower-summary]')).toContainText(/Tower t1, player\.1 \S/); // glyph stays in the live-region summary
  await page.getByRole('checkbox',{name:'Reduced motion'}).focus(); await page.keyboard.press('Space');
  await expect(page.getByRole('checkbox',{name:'Reduced motion'})).toBeChecked();
  await page.getByRole('checkbox',{name:'Performance HUD'}).check();
  await expect(page.getByLabel('Performance metrics')).toContainText('sim step');
});

test('colourblind palette recolours the 3D tower and keeps the glyph in the summary', async({page})=>{
  await page.goto('/?test=1'); await expect(page.getByRole('button',{name:'Play',exact:true})).toBeVisible();
  await page.evaluate(()=>window.__na!.settings({quality:'low',reducedMotion:true,colorblind:false}));
  await page.evaluate(()=>window.__na!.load('sample')); await expect(page.locator('main')).toHaveAttribute('data-screen','playing');
  const before=await page.evaluate(()=>window.__na!.presentation().towers[0]!);
  await page.evaluate(()=>window.__na!.settings({colorblind:true}));
  await expect.poll(()=>page.evaluate(()=>window.__na!.presentation().towers[0]!.color)).not.toBe(before.color);
  const after=await page.evaluate(()=>window.__na!.presentation().towers[0]!); expect(after.glyph).toBeTruthy();
  await expect(page.locator('[data-tower-summary]')).toContainText(String(after.glyph)); await expect(page.locator('[data-tower-index]')).toHaveCount(0);
});
