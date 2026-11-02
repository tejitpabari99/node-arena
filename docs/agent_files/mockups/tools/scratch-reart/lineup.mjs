import { chromium } from '/root/projects/node-arena/node_modules/.pnpm/playwright@1.64.0/node_modules/playwright/index.mjs';
const out = '/tmp/claude-0/-root-projects-node-arena/81e69880-d03b-467f-b52a-81a00c29b2a1/scratchpad/remodel/';
const jobs = process.argv.slice(2); // e.g. a:buildings:name:extraQuery
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const j of jobs) {
  const [set, mode, name, extra = ''] = j.split(':');
  const p = await (await b.newContext({ viewport: { width: 1440, height: 810 } })).newPage();
  const errs = []; p.on('console', m => { if (['error', 'warning'].includes(m.type())) errs.push(m.text()); }); p.on('pageerror', e => errs.push(String(e)));
  await p.goto(`http://127.0.0.1:4320/reart-lineup.html?set=${set}&mode=${mode}${extra ? '&' + extra : ''}`);
  await p.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  await p.screenshot({ path: out + name + '.png' });
  if (errs.length) console.log(j, errs.slice(0, 4));
  await p.context().close();
}
await b.close();
