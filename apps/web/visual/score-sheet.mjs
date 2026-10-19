#!/usr/bin/env node
// visual:score-sheet (PRD SP01 Req 1, Scoring protocol step 3): blank blind score sheet per scene for the blind scorer:
// relevant CHECKLIST items (Scene column, or the ref-map.json entry's `items` for appended scenes) with 4/6/8/10 anchors,
// the ref list and composite path, empty score/differences. No metrics, prior scores or code paths.
// Usage: pnpm --filter @node-arena/web visual:score-sheet [--scene id[,id]]   (default: every ref-map.json scene)
// Output: visual-out/score-sheet-<id>.md
import fs from 'node:fs';
import path from 'node:path';
import { OUT_DIR } from './lib/scenes.mjs';
import { resolveRefDir } from './lib/refs.mjs';
import { loadRefMap } from './lib/compose.mjs';
import { loadChecklist, scoreSheet } from './lib/checklist.mjs';

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

try {
  const opts = parse(process.argv.slice(2));
  const checklist = loadChecklist(), refMap = loadRefMap(), refDir = resolveRefDir();
  if (checklist.errors.length) throw new Error(`CHECKLIST.md: ${checklist.errors.join('; ')}`);
  const scenes = opts.scenes.length ? opts.scenes : Object.keys(refMap.scenes);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const scene of scenes) {
    const file = path.join(OUT_DIR, `score-sheet-${scene}.md`);
    fs.writeFileSync(file, scoreSheet({ checklist, refMap, scene, refDir, outDir: OUT_DIR }));
    const composite = path.join(OUT_DIR, `compare-${scene}.png`);
    console.log(`[visual:score-sheet] ${path.relative(process.cwd(), file)}${fs.existsSync(composite) ? '' : ' (composite missing: run visual:compose)'}`);
  }
} catch (error) { console.error('[visual:score-sheet] FAILED:', error?.message ?? error); process.exit(1); }
