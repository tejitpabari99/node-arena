import { chromium } from '/root/projects/node-arena/node_modules/.pnpm/playwright@1.64.0/node_modules/playwright/index.mjs';
const out = '/tmp/claude-0/-root-projects-node-arena/81e69880-d03b-467f-b52a-81a00c29b2a1/scratchpad/xmas/';
const only = process.argv.slice(2); // names: map3 map19 lineup
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const mk = async () => { const p = await (await b.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1 })).newPage(); const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push(String(e))); p.errs = errs; return p; };
const U = 'http://127.0.0.1:4340/';
for (const [name, lvl] of [['map3', 3], ['map19', 19]]) {
  if (only.length && !only.includes(name)) continue;
  const p = await mk();
  await p.goto(`${U}?level=${lvl}&models=xmas`);
  await p.waitForFunction(() => { const c = document.querySelector('#arena canvas'); return c && c.width > 100; }, null, { timeout: 60000 });
  await p.waitForTimeout(11000);
  await p.screenshot({ path: `${out}${name}-hud.png`, timeout: 180000 });
  await p.addStyleTag({ content: '#game-hud,.mute-button,.battle-back,.battle-zoom,.battle-ownership{visibility:hidden!important}' });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}${name}-clean.png`, timeout: 180000 });
  if (p.errs.length) console.log(name, p.errs.slice(0, 5));
  await p.context().close();
}
if (!only.length || only.includes('lineup')) for (const [name, q] of [['lineup-buildings', 'mode=buildings&team=red'], ['lineup-units', 'mode=units&props=1'], ['lineup-units-snow', 'mode=units&props=1&theme=snow'], ['lineup-buildings-snow', 'mode=buildings&theme=snow']]) {
  const p = await mk();
  await p.goto(`${U}reart-lineup.html?set=xmas&${q}`);
  await p.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  await p.screenshot({ path: out + name + '.png' });
  if (p.errs.length) console.log(name, p.errs.slice(0, 5));
  await p.context().close();
}
await b.close();
