#!/usr/bin/env node
// visual:compose (PRD SP01 Req 7, Decision 4): per scene, screenshots an HTML grid (compose.html.tpl) with Playwright:
// current capture (1920x1080 primary, other viewports stacked; multi-frame scenes side by side) | ref-map.json refs
// at equal height | detail crops (first owned tower, lane midpoint, troop cluster, clash point). No image libs.
// Usage: pnpm --filter @node-arena/web visual:compose [--scene id[,id]]   (run visual:capture first)
// Output: visual-out/compare-<scene>.png (+ visual-out/compose/<scene>.html for inspection).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { OUT_DIR, levelScenes, loadScenes } from './lib/scenes.mjs';
import { chromium } from '@playwright/test';
import { gitCommit } from './lib/browser.mjs';
import { resolveRefDir } from './lib/refs.mjs';
import { composeModel, imageSize, loadRefMap, loadTemplate, renderHtml, validateRefMap } from './lib/compose.mjs';

// CPU raster + JS resampling in compose.html.tpl: browser <img> downscaling was not bit-stable run to run (iteration log).
// --allow-file-access-from-files lets the page read file:// pixels (getImageData) for that resampling.
const COMPOSE_ARGS = ['--disable-gpu', '--disable-gpu-compositing', '--disable-gpu-rasterization', '--allow-file-access-from-files'];

function parse(argv) {
  const opts = { scenes: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scene') opts.scenes.push(...(argv[++i] ?? '').split(',').filter(Boolean));
    else if (a.startsWith('--scene=')) opts.scenes.push(...a.slice(8).split(',').filter(Boolean));
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

async function main() {
  const opts = parse(process.argv.slice(2));
  const config = loadScenes(), refMap = loadRefMap(), refDir = resolveRefDir(), template = loadTemplate();
  const errors = validateRefMap(refMap, config, fs.readdirSync(refDir));
  if (errors.length) throw new Error(`ref-map.json invalid:\n  ${errors.join('\n  ')}`);
  // lvl-NN (--all-levels) scenes are composed only when asked for by --scene.
  const levels = levelScenes().filter(s => opts.scenes.includes(s.id)), known = [...config.scenes, ...levelScenes()].map(s => s.id);
  for (const id of opts.scenes) if (!known.includes(id)) throw new Error(`unknown scene ${id} (expected ${known.join('|')})`);
  const file = path.join(OUT_DIR, 'metrics.json');
  if (!fs.existsSync(file)) throw new Error(`${path.relative(process.cwd(), file)} missing: run visual:capture first`);
  const metrics = JSON.parse(fs.readFileSync(file, 'utf8'));
  const git = gitCommit(), commit = git.sha ? `${git.sha.slice(0, 7)}${git.dirty ? '+dirty' : ''}` : null;
  const htmlDir = path.join(OUT_DIR, 'compose');
  fs.mkdirSync(htmlDir, { recursive: true });

  const browser = await chromium.launch({ headless: true, args: COMPOSE_ARGS });
  const missing = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'reduce' });
    const page = await context.newPage();
    for (const scene of [...config.scenes, ...levels]) {
      if (opts.scenes.length && !opts.scenes.includes(scene.id)) continue;
      const byViewport = metrics.scenes?.[scene.id];
      if (!byViewport || !Object.keys(byViewport).length) { missing.push(scene.id); console.error(`[visual:compose] ${scene.id}: not in metrics.json (capture it first)`); continue; }
      for (const entry of Object.values(byViewport)) for (const f of entry.frames) if (!fs.existsSync(path.join(OUT_DIR, f.png))) throw new Error(`${scene.id}: ${f.png} missing in visual-out (re-run visual:capture)`);
      const refs = refMap.scenes[scene.id].refs.map(r => ({ ...r, ...imageSize(fs.readFileSync(path.join(refDir, r.file))) }));
      const model = composeModel({ scene, byViewport, refs, outDir: OUT_DIR, refDir, commit });
      const htmlFile = path.join(htmlDir, `${scene.id}.html`);
      fs.writeFileSync(htmlFile, renderHtml(template, model));
      await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
      await page.evaluate(async () => { await document.fonts.ready; return window.__composeReady; }); // throws on a failed image
      const size = await page.evaluate(() => { const r = document.getElementById('sheet').getBoundingClientRect(); return { width: Math.ceil(r.width), height: Math.ceil(r.height) }; });
      await page.setViewportSize(size);
      const out = path.join(OUT_DIR, `compare-${scene.id}.png`);
      await page.screenshot({ path: out, clip: { x: 0, y: 0, ...size }, animations: 'disabled', caret: 'hide', timeout: 120_000 });
      console.log(`[visual:compose] ${path.relative(process.cwd(), out)} ${size.width}x${size.height} (${model.current.map(c => `${c.viewport}x${c.frames.length}`).join(', ')}; refs ${refs.map(r => r.file).join(', ')}; crops ${model.crops.filter(c => c.rect).map(c => c.key).join('/') || 'n/a'})`);
    }
    await context.close();
  } finally { await browser.close(); }
  if (missing.length) { console.error(`[visual:compose] missing scenes: ${missing.join(', ')}`); process.exit(1); }
}

main().catch(err => { console.error(`[visual:compose] ${err.stack ?? err}`); process.exit(1); });
