#!/usr/bin/env node
// visual:calibrate (PRD SP01 Iteration protocol step 4a): runs the pixel metrics (M09, M10, M11, M14, M18 and the pixel
// parts of M02/M16/M19/M20) on the ref crops in ref-calib.json. Every metric must pass on every ref; a failure means the
// metric is wrong (fix the metric, never the ref).
// Usage: pnpm --filter @node-arena/web visual:calibrate [--metrics M09,M10,...]   Output: visual-out/calibrate.json; exit 1 on a fail.
import fs from 'node:fs';
import path from 'node:path';
import { OUT_DIR } from './lib/scenes.mjs';
import { launch } from './lib/browser.mjs';
import { openPixelPage } from './lib/pixels.mjs';
import { calibrateRef, formatTable, loadThresholds } from './lib/metrics.mjs';
import { loadRefCalib, loadRefs, resolveRefDir } from './lib/refs.mjs';

async function main() {
  const argv = process.argv.slice(2);
  let only = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--metrics') only = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (argv[i].startsWith('--metrics=')) only = argv[i].slice(10).split(',').filter(Boolean);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  const thresholds = loadThresholds(), calib = loadRefCalib(), dir = resolveRefDir();
  const { browser } = await launch({});
  let refs;
  try {
    const pixels = await openPixelPage(browser);
    refs = await loadRefs(pixels, calib, dir);
  } finally { await browser.close(); }
  let rows = refs.flatMap(ref => calibrateRef(ref, refs.filter(o => o !== ref), thresholds));
  if (only) rows = rows.filter(r => only.includes(r.id));
  console.log(`[visual:calibrate] refs from ${path.relative(process.cwd(), dir) || dir}`);
  console.log(formatTable(rows, thresholds));
  const failing = rows.filter(r => r.status === 'fail');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'calibrate.json'), `${JSON.stringify({ schema: 1, refDir: dir, metrics: only, rows: rows.map(({ id, scene, status, value, text }) => ({ id, ref: scene, status, value, text })) }, null, 2)}\n`);
  console.log(`[visual:calibrate] ${failing.length ? 'FAIL' : 'PASS'}: ${rows.length - failing.length}/${rows.length} rows pass${failing.length ? ` (failing: ${[...new Set(failing.map(r => `${r.id}@${r.scene}`))].join(', ')})` : ''}`);
  if (failing.length) process.exit(1);
}

main().catch(error => { console.error('[visual:calibrate] FAILED:', error?.stack ?? error); process.exit(1); });
