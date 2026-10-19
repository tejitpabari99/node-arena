#!/usr/bin/env node
// visual:score-merge (PRD SP01 Scoring protocol step 3): merges the iterating agent's and the blind scorer's score files
// ({V..: {score, differences[]}}): any score >=8 with <3 differences is capped at 7, item = min(self, blind),
// |self-blind| >= 3 is flagged for the iteration log, an item missing from either file merges to null (fails).
// Usage: pnpm --filter @node-arena/web visual:score-merge <self.json> <blind.json> [--out merged.json]
// Default output: score-merged-<iter>.json next to <self.json> (score-self-<iter>.json), else <self>-merged.json.
import fs from 'node:fs';
import path from 'node:path';
import { mergeScores } from './lib/checklist.mjs';

function parse(argv) {
  const files = [];
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out = argv[++i] ?? null;
    else if (a.startsWith('--out=')) out = a.slice(6);
    else if (a.startsWith('--')) throw new Error(`unknown argument ${a}`);
    else files.push(a);
  }
  if (files.length !== 2) throw new Error('usage: visual:score-merge <self.json> <blind.json> [--out merged.json]');
  return { self: files[0], blind: files[1], out };
}

const fmt = v => (v === null ? '-' : String(v));
try {
  const opts = parse(process.argv.slice(2));
  const read = f => JSON.parse(fs.readFileSync(path.resolve(f), 'utf8'));
  const merged = { ...mergeScores(read(opts.self), read(opts.blind)), self: path.resolve(opts.self), blind: path.resolve(opts.blind) };
  const base = path.basename(opts.self);
  const out = path.resolve(opts.out ?? path.join(path.dirname(opts.self), base.includes('score-self') ? base.replace('score-self', 'score-merged') : base.replace(/(\.json)?$/, '-merged.json')));
  fs.writeFileSync(out, `${JSON.stringify(merged, null, 2)}\n`);
  console.log('item  self  blind  merged  flags');
  for (const [id, r] of Object.entries(merged.items)) console.log(`${id}  ${fmt(r.self).padStart(4)}  ${fmt(r.blind).padStart(5)}  ${fmt(r.merged).padStart(6)}  ${r.flags.join(' ')}`);
  console.log(`[visual:score-merge] ${Object.keys(merged.items).length} items, flagged |self-blind|>=3: ${merged.flagged.join(', ') || 'none'}, missing: ${merged.missing.join(', ') || 'none'} -> ${path.relative(process.cwd(), out)}`);
} catch (error) { console.error('[visual:score-merge] FAILED:', error?.message ?? error); process.exit(1); }
