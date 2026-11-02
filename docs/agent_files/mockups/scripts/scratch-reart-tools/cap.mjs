import { chromium } from '/root/projects/node-arena/node_modules/.pnpm/playwright@1.64.0/node_modules/playwright/index.mjs';
const out = '/tmp/claude-0/-root-projects-node-arena/81e69880-d03b-467f-b52a-81a00c29b2a1/scratchpad/remodel/';
const sets = process.argv.slice(2); // a b baseline, optional :art
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const s of sets) {
  const [set, art] = s.split(':');
  for (const [name, lvl] of [['grass', 3], ['snow', 19]].filter(x => !process.env.ONLY || x[0] === process.env.ONLY)) {
    const p = await (await b.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1 })).newPage();
    const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push(String(e)));
    await p.goto(`http://127.0.0.1:4320/?level=${lvl}${set === 'base' ? '' : '&models=' + set}${art ? '&art=' + art : ''}`);
    await p.waitForFunction(() => { const c = document.querySelector('#arena canvas'); return c && c.width > 100; }, null, { timeout: 60000 });
    await p.waitForTimeout(11000);
    await p.addStyleTag({ content: '#game-hud{display:none!important}' });
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}${set}${art ? '-' + art : ''}-${name}.png` });
    if (errs.length) console.log(s, name, errs.slice(0, 5));
    await p.context().close();
  }
}
await b.close();
