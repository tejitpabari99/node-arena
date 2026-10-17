import { test, expect } from '@playwright/test';
test('query gates live tuning; apply restarts and downloads actual authored JSON',async({page})=>{
  await page.goto('/'); await expect(page.getByRole('button',{name:'Play',exact:true})).toBeVisible();
  await expect(page.getByText('Live tuning',{exact:false})).toHaveCount(0);
  await page.goto('/?dev=1'); await expect(page.getByRole('button',{name:'Play',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await page.getByRole('button',{name:/1 Sample/}).click();
  await expect(page.locator('[data-tower-labels]')).toBeVisible();
  await page.locator('.dev-panel summary').click();
  const rate=page.getByRole('spinbutton',{name:'data/archetypes/standard.json/components/generates/ratePerSec',exact:true});
  await rate.fill('7');
  await page.getByRole('button',{name:'Apply and restart'}).click();
  await expect(page.getByRole('status').filter({hasText:'Tuned · completion disabled'})).toBeVisible();
  // The garrison ticks in real time and polling can skip any single value, so assert a threshold that only the
  // tuned rate (7/s) can reach from the sample start of 10 within the window; the old rate (1/s) tops out at ~20.
  await expect.poll(async()=>Number(await page.locator('[data-tower-index="0"] [data-component="garrison"]').innerText()),{timeout:10000}).toBeGreaterThanOrEqual(25);
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export JSON'}).click();
  const exported=await download;
  expect(exported.suggestedFilename()).toBe('data__archetypes__standard.json');
  const stream=await exported.createReadStream(); let text=''; for await(const chunk of stream!) text+=chunk.toString();
  expect(JSON.parse(text).components.generates.ratePerSec).toBe(7);
  await page.locator('.dev-panel summary').click();
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  const before=await page.locator('[data-tower-index="0"]').getAttribute('data-team-color');
  await page.getByRole('checkbox',{name:'Colourblind palette'}).check();
  const after=await page.locator('[data-tower-index="0"]').getAttribute('data-team-color'); expect(after).not.toBe(before);
  await expect(page.locator('[data-tower-index="0"] [data-team-marker]')).not.toBeEmpty();
  await page.getByRole('checkbox',{name:'Reduced motion'}).focus(); await page.keyboard.press('Space');
  await expect(page.getByRole('checkbox',{name:'Reduced motion'})).toBeChecked();
  await page.getByRole('checkbox',{name:'Performance HUD'}).check();
  await expect(page.getByLabel('Performance metrics')).toContainText('sim step');
});
