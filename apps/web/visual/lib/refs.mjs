// Reference images (PRD SP01 Req 7 / step 4a): ref dir resolved by glob docs/agent_files/*visual-mechanics-overhaul*/ref
// (override VISUAL_REF_DIR); ref-calib.json lists the calibration crops. Refs are read-only.
import fs from 'node:fs';
import path from 'node:path';
import { VISUAL_DIR, WEB_DIR } from './scenes.mjs';
import { prepareRef } from './metrics.mjs';

export const REPO_DIR = path.resolve(WEB_DIR, '..', '..');

/** VISUAL_REF_DIR, else the last (newest timestamp) docs/agent_files/*visual-mechanics-overhaul*\/ref directory. */
export function resolveRefDir(env = process.env, repo = REPO_DIR) {
  if (env.VISUAL_REF_DIR) return path.resolve(env.VISUAL_REF_DIR);
  const base = path.join(repo, 'docs', 'agent_files');
  const hits = fs.existsSync(base) ? fs.readdirSync(base).filter(d => d.includes('visual-mechanics-overhaul') && fs.existsSync(path.join(base, d, 'ref'))).sort() : [];
  if (!hits.length) throw new Error(`no ref dir: docs/agent_files/*visual-mechanics-overhaul*/ref (set VISUAL_REF_DIR)`);
  return path.join(base, hits.at(-1), 'ref');
}

export function loadRefCalib(file = path.join(VISUAL_DIR, 'ref-calib.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Decodes every ref-calib ref with the pixel page and prepares it (frame crop, tower crops, class vectors). */
export async function loadRefs(pixels, calib = loadRefCalib(), dir = resolveRefDir()) {
  const out = [];
  for (const spec of calib.refs) out.push(prepareRef(spec, await pixels.decode(path.join(dir, spec.file))));
  return out;
}
