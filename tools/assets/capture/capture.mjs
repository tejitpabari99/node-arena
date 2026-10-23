#!/usr/bin/env node
// assets:capture — headless Playwright capture of named scenes at 1600x900 -> BF/ref/out/<scene>.png.
// Usage: pnpm assets:capture [--scene a,b|all] [--compare] [--out dir] [--port 4180]
//   --compare also writes <scene>.compare.png = our capture | reference (scene `ref` in scenes/index.js, under BF/ref/).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scenes, sceneNames } from './scenes/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const BF = path.join(root, 'docs/agent_files/feat-tower-war-port-20261022-0321');
const REF = path.join(BF, 'ref');
const web = createRequire(path.join(root, 'apps/web/package.json'));
const pw = await import(pathToFileURL(web.resolve('@playwright/test')).href);
const chromium = pw.chromium ?? pw.default.chromium;
const { createServer } = await import(pathToFileURL(web.resolve('vite')).href);

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const compare = args.includes('--compare');
const outDir = path.resolve(opt('out', path.join(REF, 'out')));
const port = Number(opt('port', 4180));
const pick = opt('scene', 'all');
const names = pick === 'all' ? sceneNames : pick.split(',');
for (const n of names) if (!sceneNames.includes(n)) { console.error(`unknown scene "${n}"; known: ${sceneNames.join(', ')}`); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

const server = await createServer({ configFile: path.join(here, 'vite.config.mjs'), logLevel: 'warn', server: { port, strictPort: true, host: '127.0.0.1' } });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'log') console.log('  [page]', m.text()); });
  for (const name of names) {
    await page.goto(`http://127.0.0.1:${port}/?scene=${encodeURIComponent(name)}`);
    try {
      await page.waitForFunction(() => window.__sceneReady || window.__sceneError, null, { timeout: 60_000 });
      const err = await page.evaluate(() => window.__sceneError);
      if (err) throw new Error(err);
      const file = path.join(outDir, `${name}.png`);
      await page.screenshot({ path: file });
      console.log(`captured ${name} -> ${path.relative(root, file)}`);
      const ref = scenes[name].ref;
      if (compare && ref) {
        const refFile = path.join(REF, ref);
        if (!fs.existsSync(refFile)) throw new Error(`ref missing: ${refFile}`);
        const uri = f => `data:${f.endsWith('.png') ? 'image/png' : 'image/jpeg'};base64,${fs.readFileSync(f).toString('base64')}`;
        const cmp = await browser.newPage({ viewport: { width: 1600 + 520, height: 900 } });
        await cmp.setContent(`<body style="margin:0;background:#222;display:flex"><img src="${uri(file)}" style="height:900px"><img src="${uri(refFile)}" style="height:900px;margin-left:8px"></body>`);
        await cmp.waitForFunction(() => [...document.images].every(i => i.complete));
        const cf = path.join(outDir, `${name}.compare.png`);
        await cmp.screenshot({ path: cf, fullPage: true });
        await cmp.close();
        console.log(`compared ${name} vs ${ref} -> ${path.relative(root, cf)}`);
      }
    } catch (e) {
      failed++;
      console.error(`FAILED ${name}: ${e.message}`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
