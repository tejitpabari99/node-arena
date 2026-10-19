#!/usr/bin/env node
// visual:check (PRD SP01 Req 1, 6; Decisions 3, 5, 8): evaluates M01-M20 on visual-out/metrics.json (+ the captured PNGs)
// against thresholds.json and prints a pass/fail/informational table. Null never passes.
// Usage: pnpm --filter @node-arena/web visual:check [--strict] [--scene id[,id]]
// Exit 1 only with --strict and at least one fail. Output: visual-out/check.json.
import fs from 'node:fs';
import path from 'node:path';
import { OUT_DIR } from './lib/scenes.mjs';
import { launch } from './lib/browser.mjs';
import { openPixelPage } from './lib/pixels.mjs';
import { evaluateJob, formatTable, loadThresholds, METRIC_IDS, summarize } from './lib/metrics.mjs';
import { loadRefs } from './lib/refs.mjs';

function parse(argv) {
  const opts = { strict: false, scenes: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--strict') opts.strict = true;
    else if (a === '--scene') opts.scenes.push(...(argv[++i] ?? '').split(',').filter(Boolean));
    else if (a.startsWith('--scene=')) opts.scenes.push(...a.slice(8).split(',').filter(Boolean));
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

async function main() {
  const opts = parse(process.argv.slice(2));
  const file = path.join(OUT_DIR, 'metrics.json');
  if (!fs.existsSync(file)) throw new Error(`${path.relative(process.cwd(), file)} missing: run visual:capture first`);
  const metrics = JSON.parse(fs.readFileSync(file, 'utf8')), thresholds = loadThresholds();
  const runFile = path.join(OUT_DIR, 'run.json'), run = fs.existsSync(runFile) ? JSON.parse(fs.readFileSync(runFile, 'utf8')) : null;
  const { browser } = await launch({});
  const rows = [];
  try {
    const pixels = await openPixelPage(browser);
    const refs = await loadRefs(pixels);
    const cache = new Map();
    const decode = async png => {
      const p = path.join(OUT_DIR, png);
      if (!fs.existsSync(p)) return null;
      if (!cache.has(png)) { cache.clear(); cache.set(png, await pixels.decode(p)); } // one frame at a time keeps memory flat
      return cache.get(png);
    };
    for (const [scene, byViewport] of Object.entries(metrics.scenes ?? {})) {
      if (opts.scenes.length && !opts.scenes.includes(scene)) continue;
      for (const [viewport, entry] of Object.entries(byViewport)) rows.push(...await evaluateJob({ scene, viewport, entry, thresholds, run, refs, pixels: decode }));
    }
  } finally { await browser.close(); }

  const order = id => METRIC_IDS.indexOf(id);
  rows.sort((a, b) => order(a.id) - order(b.id)); // stable: scene/viewport keep metrics.json order
  console.log(formatTable(rows, thresholds));
  const summary = summarize(rows), counts = { pass: 0, fail: 0, info: 0 };
  for (const r of rows) counts[r.status]++;
  console.log('');
  console.log(METRIC_IDS.map(id => `${id} ${summary[id].toUpperCase()}`).join('  '));
  const failing = METRIC_IDS.filter(id => summary[id] === 'fail');
  console.log(`[visual:check] ${rows.length} rows: ${counts.pass} pass, ${counts.fail} fail, ${counts.info} info; failing metrics: ${failing.join(', ') || 'none'}${run ? ` (gpu: ${run.gpu}, renderer: ${run.renderer?.renderer ?? '?'})` : ''}`);
  fs.writeFileSync(path.join(OUT_DIR, 'check.json'), `${JSON.stringify({ schema: 1, strict: opts.strict, summary, counts, rows }, null, 2)}\n`);
  if (opts.strict && counts.fail) process.exit(1);
}

main().catch(error => { console.error('[visual:check] FAILED:', error?.stack ?? error); process.exit(1); });
