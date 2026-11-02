import { chromium } from '/root/projects/node-arena/node_modules/.pnpm/playwright@1.64.0/node_modules/playwright/index.mjs';
const out = '/tmp/claude-0/-root-projects-node-arena/81e69880-d03b-467f-b52a-81a00c29b2a1/scratchpad/future/';
const what = process.argv.slice(2); // game | lineup
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = async () => (await b.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1 })).newPage();
const watch = (p, tag) => { p.on('console', m => { if (['error', 'warning'].includes(m.type())) console.log(tag, m.text().slice(0, 300)); }); p.on('pageerror', e => console.log(tag, 'PAGEERR', String(e).slice(0, 300))); };
if (what.includes('game')) for (const [name, lvl] of [['grass', 3], ['snow', 19]].filter(x => !process.env.GONLY || x[0] === process.env.GONLY)) {
  const p = await ctx(); watch(p, name);
  await p.goto(`http://127.0.0.1:4330/?level=${lvl}&models=future`);
  await p.waitForFunction(() => { const c = document.querySelector('#arena canvas'); return c && c.width > 100; }, null, { timeout: 90000 });
  await p.waitForTimeout(11000);
  await p.screenshot({ path: `${out}${name}-hud.png`, timeout: 120000 });
  await p.addStyleTag({ content: '#game-hud{display:none!important}' }); await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}${name}-clean.png`, timeout: 120000 });
  await p.context().close();
}
if (what.includes('lineup')) for (const [name, q] of [['lineup-buildings', 'mode=buildings&theme=grass'], ['lineup-units', 'mode=units&props=1&theme=grass'], ['lineup-units-snow', 'mode=units&props=1&theme=snow'], ['lineup-buildings-red', 'mode=buildings&theme=snow&team=red']]) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) continue;
  const p = await ctx(); watch(p, name);
  await p.goto(`http://127.0.0.1:4330/reart-lineup.html?set=future&${q}`);
  await p.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  await p.waitForTimeout(500); await p.screenshot({ path: `${out}${name}.png` });
  await p.context().close();
}
await b.close();
