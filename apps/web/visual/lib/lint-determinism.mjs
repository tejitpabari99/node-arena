// Determinism lint (PRD SP01 N6): render/fx code must not read wall clocks or unseeded randomness.
// Render jitter uses seededRandom(pairKey, tick) from src/render/rng.ts instead.
// Allow-list: anything under test-harness/, and perf-sampling lines marked `determinism-allow: perf`.
// CLI: node visual/lib/lint-determinism.mjs  (exit 1 on any hit). Also run first by visual:selfcheck.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEB_DIR } from './scenes.mjs';

export const BANNED = /Math\.random|crypto\.getRandomValues|Date\.now|performance\.now/;
export const DEFAULT_ROOTS = ['src/render', 'src/fx'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.jsx', '.glsl', '.vert', '.frag']);
const ALLOW_LINE = /determinism-allow:\s*perf/;
const ALLOW_DIR = 'test-harness';

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== ALLOW_DIR) walk(full, out); }
    else if (EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

/** Returns [{ file (relative to cwd, posix), line, column, match, text }] sorted by file, line, column. */
export function lintDeterminism({ cwd = WEB_DIR, roots = DEFAULT_ROOTS } = {}) {
  const hits = [];
  const global = new RegExp(BANNED.source, 'g');
  for (const root of roots) {
    const dir = path.resolve(cwd, root);
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir, [])) {
      const rel = path.relative(cwd, file).split(path.sep).join('/');
      fs.readFileSync(file, 'utf8').split('\n').forEach((text, i) => {
        if (ALLOW_LINE.test(text)) return;
        for (const m of text.matchAll(global)) hits.push({ file: rel, line: i + 1, column: m.index + 1, match: m[0], text: text.trim() });
      });
    }
  }
  return hits;
}

export function formatHits(hits) {
  return hits.map(h => `  ${h.file}:${h.line}:${h.column} ${h.match}  | ${h.text}`).join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hits = lintDeterminism();
  if (hits.length) {
    console.error(`[lint-determinism] ${hits.length} banned call(s) in ${DEFAULT_ROOTS.join(', ')} (use seededRandom(pairKey, tick) from src/render/rng.ts):\n${formatHits(hits)}`);
    process.exit(1);
  }
  console.log(`[lint-determinism] clean (${DEFAULT_ROOTS.join(', ')})`);
}
