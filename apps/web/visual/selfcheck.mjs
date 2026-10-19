#!/usr/bin/env node
// visual:selfcheck (PRD SP01 Req 1, AC "identical hashes", N6): determinism lint, then visual:capture x2 and a
// per-PNG comparison (SHA-256; fallback <=0.01% differing pixels with channel delta <=2 via the pixel helper)
// plus metrics.json equality after dropping `perf`.
// Usage: pnpm --filter @node-arena/web visual:selfcheck [--lint-only] [capture args: --scene id --viewport WxH --gpu --headed --dev --no-build]
// Output: apps/web/visual-out/selfcheck/{run-1,run-2}/ (copies of each capture) + report.json. Exit 1 unless green.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { OUT_DIR, parseArgs, VISUAL_DIR, WEB_DIR } from './lib/scenes.mjs';
import { launch } from './lib/browser.mjs';
import { openPixelPage } from './lib/pixels.mjs';
import { DEFAULT_ROOTS, formatHits, lintDeterminism } from './lib/lint-determinism.mjs';
import { comparableMetrics, diffJson, judgePng, verdict } from './lib/selfcheck.mjs';

const log = (...a) => console.log('[visual:selfcheck]', ...a);
const SELF_DIR = path.join(OUT_DIR, 'selfcheck');
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function capture(args, run) {
  log(`capture run ${run}: visual:capture ${args.join(' ')}`.trim());
  const r = spawnSync(process.execPath, [path.join(VISUAL_DIR, 'capture.mjs'), ...args], { cwd: WEB_DIR, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`visual:capture run ${run} failed (${r.status ?? r.signal})`);
  const dir = path.join(SELF_DIR, `run-${run}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const runJson = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'run.json'), 'utf8'));
  for (const f of [...runJson.files, 'metrics.json', 'run.json']) fs.copyFileSync(path.join(OUT_DIR, f), path.join(dir, f));
  return { dir, run: runJson, metrics: JSON.parse(fs.readFileSync(path.join(dir, 'metrics.json'), 'utf8')) };
}

async function main() {
  const argv = process.argv.slice(2);
  const lintOnly = argv.includes('--lint-only');
  const captureArgs = argv.filter(a => a !== '--lint-only');
  const opts = parseArgs(captureArgs); // validates before any work

  const lintHits = lintDeterminism();
  if (lintHits.length) {
    console.error(`[visual:selfcheck] FAIL determinism lint: ${lintHits.length} banned call(s) in ${DEFAULT_ROOTS.join(', ')} (seed render jitter with seededRandom(pairKey, tick) from src/render/rng.ts):\n${formatHits(lintHits)}`);
    process.exit(1);
  }
  log(`determinism lint clean (${DEFAULT_ROOTS.join(', ')})`);
  if (lintOnly) return;

  fs.mkdirSync(SELF_DIR, { recursive: true });
  const a = capture(captureArgs, 1);
  const b = capture(opts.build ? [...captureArgs, '--no-build'] : captureArgs, 2); // same dist-test for both runs

  const jobsA = a.run.jobs, jobsB = b.run.jobs;
  const pngNames = [...new Set([...a.run.files, ...b.run.files])].sort();
  const pngs = [];
  const { browser } = await launch({ gpu: opts.gpu });
  try {
    const pixels = await openPixelPage(browser);
    for (const png of pngNames) {
      const fa = path.join(a.dir, png), fb = path.join(b.dir, png);
      const sa = a.run.files.includes(png) ? sha256(fa) : undefined, sb = b.run.files.includes(png) ? sha256(fb) : undefined;
      const diff = sa && sb && sa !== sb ? await pixels.diff(fa, fb) : null;
      pngs.push({ png, sha256: [sa ?? null, sb ?? null], ...judgePng(sa, sb, diff) });
    }
    await pixels.close();
  } finally {
    await browser.close();
  }

  const relaxed = new Set(pngs.filter(p => p.status === 'near').map(p => p.png));
  const metricsDiffs = diffJson(jobsA, jobsB, '$jobs');
  metricsDiffs.push(...diffJson(comparableMetrics(a.metrics, jobsA, relaxed), comparableMetrics(b.metrics, jobsA, relaxed), '$metrics'));
  const result = verdict({ pngs, metricsDiffs, lintHits });
  const counts = { identical: 0, near: 0, fail: 0 };
  for (const p of pngs) counts[p.status]++;
  const report = { verdict: result, commit: a.run.commit, renderer: a.run.renderer?.renderer ?? null, jobs: jobsA.length, pngs: pngs.length, counts, metricsDiffs: metricsDiffs.slice(0, 50), metricsDiffCount: metricsDiffs.length, lintHits, files: pngs };
  fs.writeFileSync(path.join(SELF_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

  for (const p of pngs.filter(p => p.status !== 'identical')) log(`${p.status.toUpperCase().padEnd(4)} ${p.png}: ${p.reason}`);
  for (const d of metricsDiffs.slice(0, 20)) log(`METRICS ${d}`);
  if (metricsDiffs.length > 20) log(`... ${metricsDiffs.length - 20} more metrics diffs (report.json)`);
  log(`${result.toUpperCase()}: ${pngs.length} PNGs (${counts.identical} identical, ${counts.near} near-identical, ${counts.fail} fail), ${metricsDiffs.length} metrics diffs, ${jobsA.length} jobs -> ${path.relative(WEB_DIR, SELF_DIR)}/report.json`);
  if (result === 'fail') process.exit(1);
}

main().catch(error => { console.error('[visual:selfcheck] FAILED:', error?.stack ?? error); process.exit(1); });
