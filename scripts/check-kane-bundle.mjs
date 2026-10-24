#!/usr/bin/env node
// Kane exclusion gate: production dist must never contain the kane level; the test-hooks build must.
// Builds both (apps/web dist, dist-test) unless --no-build; then, for production, serves dist and
// checks `/` and `/?kane=1` both show the 20-card picker (no kane boot, no window.__na).
import { execFileSync, spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps/web');
const markers = ['na-kane', 'Kane Arena'];
const run = (args) => execFileSync('pnpm', args, { cwd: root, stdio: 'inherit' });
if (!process.argv.includes('--no-build')) { run(['--filter', '@node-arena/web', 'build']); run(['--filter', '@node-arena/web', 'build:test']); }

function count(dir) {
  const hits = {}; for (const m of markers) hits[m] = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n), s = statSync(p);
    if (s.isDirectory()) walk(p); else if (/\.(js|mjs|css|html|json|map|txt)$/.test(n)) { const t = readFileSync(p, 'utf8'); for (const m of markers) if (t.includes(m)) hits[m].push(p.slice(dir.length + 1)); } } };
  walk(dir); return hits;
}
let failed = false;
const fail = (msg) => { console.error(`FAIL ${msg}`); failed = true; };
const prod = count(join(web, 'dist')), test = count(join(web, 'dist-test'));
for (const m of markers) {
  if (prod[m].length) fail(`production dist contains "${m}": ${prod[m].join(', ')}`); else console.log(`ok   dist: 0 files with "${m}"`);
  if (!test[m].length) fail(`dist-test (VITE_TEST_HOOKS=1) has no "${m}"`); else console.log(`ok   dist-test: ${test[m].length} file(s) with "${m}"`);
}

const { chromium } = createRequire(join(web, 'package.json'))('@playwright/test');
const server = spawn('pnpm', ['--filter', '@node-arena/web', 'exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], { cwd: root, stdio: 'ignore' });
try {
  for (let i = 0; ; i++) { try { if ((await fetch('http://127.0.0.1:4174/')).ok) break; } catch { /* retry */ } if (i > 60) throw new Error('preview server did not start'); await new Promise((r) => setTimeout(r, 500)); }
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const path of ['/', '/?kane=1']) {
    const page = await browser.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:4174${path}`);
    await page.waitForSelector('.level-grid.campaign .level-card', { timeout: 20000 });
    const cards = await page.locator('.level-grid.campaign .level-card').count();
    const hooks = await page.evaluate(() => typeof window.__na);
    if (cards !== 20 || hooks !== 'undefined' || errors.length) fail(`production ${path}: cards=${cards} (want 20) __na=${hooks} errors=${errors.join('|')}`); else console.log(`ok   production ${path}: 20-card picker, no test hooks`);
    await page.close();
  }
  await browser.close();
} finally { server.kill(); }
process.exit(failed ? 1 : 0);
