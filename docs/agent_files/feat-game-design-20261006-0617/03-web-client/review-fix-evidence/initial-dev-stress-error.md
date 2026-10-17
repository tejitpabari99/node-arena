# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: acceptance.spec.ts >> full runtime stress and twenty level-switch GPU/DOM baseline
- Location: e2e/acceptance.spec.ts:92:1

# Error details

```
Error: expect(received).toBeLessThan(expected)

Expected: < 4
Received:   4.199999809265137
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic "Arena" [ref=e2]:
    - generic:
      - generic "▲, Lines 1 of 3 slots, Garrison 100000":
        - generic: ▲
        - generic "Lines 1 of 3 slots": ●○○
        - generic "Garrison 100000": "100000"
      - generic "■, Lines 0 of 3 slots, Garrison 3210":
        - generic: ■
        - generic "Lines 0 of 3 slots": ○○○
        - generic "Garrison 3210": "3210"
      - generic "○, Lines 0 of 2 slots, Garrison 15":
        - generic: ○
        - generic "Lines 0 of 2 slots": ○○
        - generic "Garrison 15": "15"
  - generic:
    - main:
      - generic:
        - generic [aria-hidden]: ▲
        - heading "Node Arena" [level=1]
        - generic: Connect. Capture. Conquer.
      - generic [ref=e4]:
        - strong [ref=e5]: Fixture 1
        - timer "Time remaining" [ref=e6]: 4:44
        - button "Game speed" [ref=e7] [cursor=pointer]: 1×
        - button "Pause" [ref=e8] [cursor=pointer]
        - button "Performance" [ref=e9] [cursor=pointer]
      - paragraph: Drag from your tower to connect · Swipe across a route or right-click to cut · Esc to pause
```

# Test source

```ts
  1   | import { test, expect, type Page } from '@playwright/test';
  2   | import { installLifetimeCensus } from './fixtures/lifetime';
  3   | import type { TestApi } from '../src/test-harness';
  4   | declare global { interface Window { __na?: TestApi } }
  5   | test.use({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  6   | async function boot(page: Page, fixture?: string) {
  7   |   await page.goto(`/?test=1${fixture ? `&fixture=${fixture}` : ''}`);
  8   |   await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  9   |   await page.evaluate(() => window.__na!.settings({ quality: 'low', reducedMotion: true }));
  10  | }
  11  | async function load(page: Page, id = 'fixture-1') {
  12  |   await page.evaluate(id => window.__na!.load(id), id);
  13  |   await expect(page.locator('main')).toHaveAttribute('data-screen', 'playing');
  14  | }
  15  | async function draw(page: Page, from = 't1', to = 't2') {
  16  |   const a = await page.evaluate(id => window.__na!.project(id), from);
  17  |   const b = await page.evaluate(id => window.__na!.project(id), to);
  18  |   await page.mouse.move(a.x,a.y); await page.mouse.down(); await page.mouse.move(b.x,b.y,{steps:8}); await page.mouse.up();
  19  |   await page.evaluate(() => window.__na!.step());
  20  | }
  21  | test('test API is absent normally, deterministic driver draws for 30 seconds and replays', async ({page}) => {
  22  |   await page.goto('/'); await expect(page.getByRole('button',{name:'Play',exact:true})).toBeVisible();
  23  |   expect(await page.evaluate(() => '__na' in window)).toBe(false);
  24  |   await boot(page); await load(page,'sample');
  25  |   const initial = await page.evaluate(() => window.__na!.hash());
  26  |   await page.waitForTimeout(100); expect(await page.evaluate(() => window.__na!.hash())).toBe(initial);
  27  |   await draw(page); await page.evaluate(() => window.__na!.step(599));
  28  |   const data = await page.evaluate(() => ({ view: window.__na!.view, events:window.__na!.events, replay:window.__na!.replay(), hash:window.__na!.hash() }));
  29  |   expect(data.view!.tick).toBe(600); expect(data.events.filter(e=>e.type==='TroopSpawned'&&e.tick>580).length).toBeGreaterThan(0);
  30  |   expect(data.view!.channels.some(c=>c.troops.length>0)).toBe(true);
  31  |   expect(data.replay.ok).toBe(true); expect(data.replay.hash).toBe(data.hash);
  32  |   expect(data.replay.record.commands[0]!.tick).toBe(0);
  33  | });
  34  | for (const method of ['right','swipe']) test(`${method} cut stops channel spawning but in-flight troops arrive`, async ({page}) => {
  35  |   await page.setViewportSize({width:960,height:600});
  36  |   await boot(page,'cut'); await load(page); await draw(page); await draw(page,'t3','t4');
  37  |   await page.evaluate(() => window.__na!.step(39));
  38  |   const before = await page.evaluate(() => window.__na!.view!);
  39  |   const channel = before.channels.find(c=>c.drawn)!;
  40  |   expect(channel.troops.length).toBeGreaterThan(0);
  41  |   const a = await page.evaluate(() => window.__na!.project('t1')), b = await page.evaluate(() => window.__na!.project('t2'));
  42  |   const mid = {x:(a.x+b.x)/2,y:(a.y+b.y)/2};
  43  |   if(method==='right') await page.mouse.click(mid.x,mid.y,{button:'right'});
  44  |   else { await page.mouse.move(mid.x,mid.y-35); await page.mouse.down(); await page.mouse.move(mid.x,mid.y+35,{steps:12}); await page.mouse.up(); }
  45  |   await page.evaluate(() => window.__na!.step());
  46  |   const cut = await page.evaluate(() => [...window.__na!.events].reverse().find(e=>e.type==='LineCut'));
  47  |   expect(cut).toMatchObject({type:'LineCut',channel:channel.key,reason:'player'});
  48  |   await page.evaluate(() => window.__na!.step(200));
  49  |   const events = await page.evaluate(() => window.__na!.events);
  50  |   expect(events.filter(e=>e.type==='TroopSpawned'&&e.channel===channel.key&&e.tick>cut!.tick)).toHaveLength(0);
  51  |   expect(events.filter(e=>e.type==='TroopSpawned'&&e.channel!==channel.key&&e.tick>cut!.tick).length).toBeGreaterThan(0);
  52  |   expect(events.filter(e=>e.type==='TroopArrived'&&e.tower===channel.to&&e.tick>cut!.tick).length).toBeGreaterThan(0);
  53  | });
  54  | test('20 authored levels, completion survives reload, retry/next and timeout have no interstitial', async ({page}) => {
  55  |   await boot(page,'victory'); await page.getByRole('button',{name:'Play',exact:true}).click();
  56  |   await expect(page.locator('.level-grid button')).toHaveCount(20);
  57  |   await page.getByRole('button',{name:/^20 Fixture 20/}).click(); await draw(page); await page.evaluate(()=>window.__na!.step(220));
  58  |   await expect(page.getByRole('heading',{name:'Victory'})).toBeVisible();
  59  |   expect(await page.evaluate(()=>window.__na!.view!.tick)).toBeLessThan(220);
  60  |   await page.getByRole('button',{name:'Retry',exact:true}).click(); await draw(page); await page.evaluate(()=>window.__na!.step(220));
  61  |   await expect(page.getByRole('heading',{name:'Victory'})).toBeVisible();
  62  |   await page.reload(); await page.getByRole('button',{name:'Play',exact:true}).click();
  63  |   await expect(page.getByRole('button',{name:/20 Fixture 20.*Completed/})).toBeVisible();
  64  |   for(let i=1;i<=20;i++) { await page.evaluate(i=>window.__na!.load(`fixture-${i}`),i); await draw(page); await page.evaluate(()=>window.__na!.step(220)); await expect(page.getByRole('heading',{name:'Victory'})).toBeVisible(); }
  65  |   await page.evaluate(()=>window.__na!.load('fixture-1')); await draw(page); await page.evaluate(()=>window.__na!.step(220));
  66  |   await page.getByRole('button',{name:'Next arena'}).click(); await expect(page.locator('.hud strong')).toHaveText('Fixture 2');
  67  |   await expect(page.locator('iframe,[class*="interstitial"],[class*="advert"],[data-ad],[class*="energy"],[class*="payment"]')).toHaveCount(0);
  68  |   await boot(page,'timeout'); await load(page); await page.evaluate(()=>window.__na!.step(100));
  69  |   await expect(page.getByRole('heading',{name:'Time is up'})).toBeVisible();
  70  |   expect(await page.evaluate(()=>window.__na!.view!.tick)).toBe(20);
  71  | });
  72  | test('capture, glyphs and clash use real event positions and current labels', async ({page}) => {
  73  |   await page.setViewportSize({width:960,height:600});
  74  |   await boot(page,'capture'); await load(page); await draw(page);
  75  |   let captured=false;
  76  |   for(let i=0;i<220;i++) { captured=await page.evaluate(()=>{window.__na!.step();return window.__na!.events.some(e=>e.type==='Captured');}); if(captured)break; }
  77  |   expect(captured).toBe(true);
  78  |   const data=await page.evaluate(()=>({view:window.__na!.view!,p:window.__na!.presentation()}));
  79  |   expect(data.p.towers[1]!.color).toBe('367be8'); expect(data.p.towers[1]!.glyph).toBe('▲');
  80  |   await expect(page.locator('[data-tower-index="1"] [data-component="garrison"]')).toContainText(String(data.view.tower.col['garrison.count']![1]));
  81  |   expect(data.p.fx.some(f=>Math.abs(f.position[0]!-40)<.01)).toBe(true);
  82  |   await expect(page).toHaveScreenshot('capture.png',{maxDiffPixelRatio:.01});
  83  |   await boot(page); await load(page,'sample'); await draw(page);
  84  |   await page.evaluate(()=>{window.__na!.submit({type:'DrawLine',player:'b1',from:'t2',to:'t1'});window.__na!.step();});
  85  |   let clash=false;
  86  |   for(let i=0;i<200;i++) { clash=await page.evaluate(()=>{window.__na!.step();return window.__na!.events.some(e=>e.type==='Clash');});if(clash)break; }
  87  |   expect(clash).toBe(true);
  88  |   const p=await page.evaluate(()=>window.__na!.presentation());
  89  |   expect(p.fx.some(f=>Math.abs(f.position[0]!)<1)).toBe(true);
  90  |   await expect(page).toHaveScreenshot('clash.png',{maxDiffPixelRatio:.01});
  91  | });
  92  | test('full runtime stress and twenty level-switch GPU/DOM baseline', async ({page}) => {
  93  |   test.setTimeout(120000);
  94  |   await installLifetimeCensus(page);
  95  |   await boot(page,'stress');
  96  |   const idleLifetime=await page.evaluate(()=>window.__lifetime());
  97  |   await load(page); await draw(page); await page.evaluate(()=>window.__na!.step(199));
  98  |   const stress=await page.evaluate(()=>window.__na!.sample());
  99  |   await test.info().attach('full-runtime-stress.json',{body:JSON.stringify(stress),contentType:'application/json'});
> 100 |   expect(stress.troops).toBeGreaterThanOrEqual(2000); expect(Math.max(...stress.calls)).toBeLessThan(100); expect(stress.p95).toBeLessThan(4);
      |                                                                                                                               ^ Error: expect(received).toBeLessThan(expected)
  101 |   await page.evaluate(()=>{window.__na!.submit({type:'CutLine',player:'p1',from:'t1',to:'t2'});window.__na!.step();});
  102 |   const baseline=await page.evaluate(()=>window.__na!.memory().current);
  103 |   const activeLifetime=await page.evaluate(()=>window.__lifetime());
  104 |   expect(activeLifetime.raf).toBe(0);
  105 |   for(let i=1;i<=20;i++) {
  106 |     await load(page,`fixture-${i}`); await draw(page); await page.evaluate(()=>{window.__na!.step(319);window.__na!.submit({type:'CutLine',player:'p1',from:'t1',to:'t2'});window.__na!.step();});
  107 |     const memory=await page.evaluate(()=>window.__na!.memory());
  108 |     expect(await page.evaluate(()=>window.__lifetime())).toEqual(activeLifetime);
  109 |     expect(memory.current).toEqual(baseline); expect(memory.labels).toBe(3); expect(memory.canvases).toBe(1);
  110 |     expect(memory.retired).toEqual(memory.retired.map(()=>({geometries:0,textures:1,contextLost:true}))); 
  111 |   }
  112 |   await page.evaluate(()=>window.__na!.menu());
  113 |   const memory=await page.evaluate(()=>window.__na!.memory());
  114 |   expect(await page.evaluate(()=>window.__lifetime())).toEqual(idleLifetime);
  115 |   await test.info().attach('full-runtime-lifetime.json',{body:JSON.stringify({baseline,memory,idleLifetime,activeLifetime}),contentType:'application/json'});
  116 |   expect(memory.labels).toBe(0); expect(memory.canvases).toBe(0); expect(memory.retired).toEqual(memory.retired.map(()=>({geometries:0,textures:1,contextLost:true}))); 
  117 | });
  118 | 
  119 | test('manifest GLB swap, failed-only asset Retry and invalid boot recovery', async ({page}) => {
  120 |   await page.setViewportSize({width:960,height:600});
  121 |   const { syntheticGlb } = await import('./fixtures/model');
  122 |   const requests: Record<string,number> = {};
  123 |   let failed=true;
  124 |   await page.route('**/manifest.json',async route=>{
  125 |     const manifest=await (await route.fetch()).json();
  126 |     manifest.visuals['tower.fixture']={...manifest.visuals['tower.standard'],scale:1.2,tint:'#00ff00'};
  127 |     manifest.models.block={src:'models/fixture-tower.glb'};
  128 |     manifest.models.unit={src:'models/fixture-troop.glb'};
  129 |     await route.fulfill({json:manifest});
  130 |   });
  131 |   await page.route('**/models/fixture-*.glb',async route=>{
  132 |     const src=new URL(route.request().url()).pathname;requests[src]=(requests[src]??0)+1;
  133 |     if(src.includes('troop')&&failed) await route.fulfill({status:503,body:'fixture unavailable'});
  134 |     else await route.fulfill({body:syntheticGlb(),contentType:'model/gltf-binary'});
  135 |   });
  136 |   await boot(page,'visual'); await page.evaluate(()=>window.__na!.load('fixture-1'));
  137 |   await expect(page.getByRole('alert')).toContainText('models/fixture-troop.glb');
  138 |   await expect(page.getByRole('alert')).toContainText('unit');
  139 |   expect(requests['/models/fixture-troop.glb']).toBe(3);expect(requests['/models/fixture-tower.glb']).toBe(1);
  140 |   failed=false;await page.getByRole('button',{name:'Retry',exact:true}).click();
  141 |   await expect(page.locator('main')).toHaveAttribute('data-screen','playing');
  142 |   expect(await page.evaluate(()=>window.__na!.view!.towerStatic[0])).toMatchObject({archetype:'fixture-building',visual:'tower.fixture'});
  143 |   expect(await page.evaluate(()=>window.__na!.presentation().towers[0]!.modelScale)).toBe(1.2);
  144 |   expect(requests['/models/fixture-troop.glb']).toBe(4);expect(requests['/models/fixture-tower.glb']).toBe(1);
  145 |   await expect(page).toHaveScreenshot('glb-fixture.png',{maxDiffPixelRatio:.01});
  146 |   await page.unroute('**/manifest.json');let invalid=true;
  147 |   await page.route('**/manifest.json',async route=>{if(invalid)await route.fulfill({json:{schemaVersion:'bad'}});else await route.continue();});
  148 |   await page.goto('/?test=1');await expect(page.getByRole('alert')).toContainText('manifest');
  149 |   invalid=false;await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.getByRole('button',{name:'Play',exact:true})).toBeVisible();
  150 | });
  151 | test('stable greybox menu, picker, game and colourblind software GL screenshots',async ({page})=>{
  152 |   await page.setViewportSize({width:960,height:600});
  153 |   await boot(page,'normal');await expect(page).toHaveScreenshot('menu.png',{maxDiffPixelRatio:.01});
  154 |   await page.getByRole('button',{name:'Play',exact:true}).click();await expect(page).toHaveScreenshot('picker.png',{maxDiffPixelRatio:.01,fullPage:true});
  155 |   await load(page);await expect(page).toHaveScreenshot('greybox.png',{maxDiffPixelRatio:.01});
  156 |   await page.evaluate(()=>window.__na!.settings({colorblind:true}));
  157 |   const colors=await page.evaluate(()=>window.__na!.presentation().towers);
  158 |   expect(colors[0]).toMatchObject({color:'0072b2',glyph:'▲'});expect(colors[1]).toMatchObject({color:'d55e00',glyph:'■'});
  159 |   await expect(page).toHaveScreenshot('colorblind.png',{maxDiffPixelRatio:.01});
  160 | });
  161 | 
```