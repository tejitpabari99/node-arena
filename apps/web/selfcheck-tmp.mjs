import { chromium } from '@playwright/test';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await page.goto('http://127.0.0.1:4174/?test=1');
await page.waitForFunction(() => window.__na && window.__na.screen === 'menu');
const id = process.argv[2];
const out = await page.evaluate(async id => {
  const na = window.__na; na.settings({ quality: 'high', reducedMotion: true, colorblind: false });
  await na.load(id, 7);
  const v = na.view; na.submit({ type: 'DrawLine', player: v.ids.players[0], from: v.ids.towers[0], to: v.ids.towers[1] });
  na.step(240); na.render(); na.render({ settle: false });
  const a = JSON.stringify(na.visualProbe()), b = JSON.stringify(na.visualProbe());
  return { same: a === b, probe: JSON.parse(a), clashes: na.events.filter(e => e.type === 'Clash').length };
}, id);
console.log('identical:', out.same, 'clashEvents:', out.clashes);
const p = out.probe; console.log(JSON.stringify({ viewport: p.viewport, clearColor: p.clearColor, ground: p.ground, tower0: p.towers[0], nTowers: p.towers.length, lanes: p.lanes, troops: { count: p.troops.count, h: p.troops.screenHeightPx, r0: p.troops.sampleRects[0] }, clash: p.clash }, null, 1));
await browser.close();
