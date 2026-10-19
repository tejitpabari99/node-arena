// CHECKLIST.md tooling (PRD SP01 Req 8, Decisions 5/10, Scoring protocol): parse the checklist tables, check that
// Appendix B / B.1 agree with thresholds.json (visual:check), build the blind score sheet (visual:score-sheet) and
// min-merge two score files (visual:score-merge). Pure functions; unit-tested in test/visual-checklist.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { REPO_DIR } from './refs.mjs';

export const ITEM_IDS = Array.from({ length: 24 }, (_, i) => `V${String(i + 1).padStart(2, '0')}`);
const METRIC_IDS = Array.from({ length: 20 }, (_, i) => `M${String(i + 1).padStart(2, '0')}`);
const ITEM_HEAD = ['ID', 'Item', 'Scene', 'Anchor refs', '4', '6', '8', '10', 'Pixel check', 'Owner'];
const METRIC_HEAD = ['ID', 'Metric', 'Source', 'Threshold', 'Ref calibration', 'St'];
const LIMIT_HEAD = ['ID', 'St', 'Scenes', 'Viewports', 'Limits'];

/** VISUAL_CHECKLIST, else the newest docs/agent_files/*visual-mechanics-overhaul*\/01-visual-qa-harness/CHECKLIST.md. */
export function resolveChecklist(env = process.env, repo = REPO_DIR) {
  if (env.VISUAL_CHECKLIST) return path.resolve(env.VISUAL_CHECKLIST);
  const base = path.join(repo, 'docs', 'agent_files'), rel = path.join('01-visual-qa-harness', 'CHECKLIST.md');
  const hits = fs.existsSync(base) ? fs.readdirSync(base).filter(d => d.includes('visual-mechanics-overhaul') && fs.existsSync(path.join(base, d, rel))).sort() : [];
  if (!hits.length) throw new Error('no CHECKLIST.md: docs/agent_files/*visual-mechanics-overhaul*/01-visual-qa-harness/CHECKLIST.md (set VISUAL_CHECKLIST)');
  return path.join(base, hits.at(-1), rel);
}

/** Cells of a Markdown table row; `\|` is a literal pipe (code spans in M12). */
export function splitRow(line) {
  const cells = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/);
  return cells.map(c => c.trim().replace(/\\\|/g, '|'));
}

function tables(md) {
  const out = [];
  let cur = null;
  for (const line of md.split('\n')) {
    if (line.trim().startsWith('|')) {
      if (!cur) { cur = { head: splitRow(line), rows: [] }; out.push(cur); }
      else if (!/^\|[\s|:-]+$/.test(line.trim())) cur.rows.push(splitRow(line));
    } else cur = null;
  }
  return out;
}

const tableBy = (all, head) => all.find(t => isDeepStrictEqual(t.head, head)) ?? null;
const unwrap = s => s.replace(/^`|`$/g, '');
const list = s => s.split(',').map(x => x.trim()).filter(Boolean);

export function parseChecklist(md) {
  const all = tables(md), errors = [];
  const it = tableBy(all, ITEM_HEAD), mt = tableBy(all, METRIC_HEAD), lt = tableBy(all, LIMIT_HEAD);
  if (!it) errors.push(`items table missing (header ${ITEM_HEAD.join(' | ')})`);
  if (!mt) errors.push(`metrics table missing (header ${METRIC_HEAD.join(' | ')})`);
  if (!lt) errors.push(`machine limits table missing (header ${LIMIT_HEAD.join(' | ')})`);
  const width = (t, n) => (t?.rows ?? []).filter(r => { if (r.length !== n) errors.push(`${r[0]}: ${r.length} cells, expected ${n}`); return r.length === n; });
  const items = width(it, ITEM_HEAD.length).map(([id, item, scene, refs, a4, a6, a8, a10, pixel, owner]) => ({ id, item, scenes: list(scene), refs, a4, a6, a8, a10, pixel, owner }));
  const metrics = width(mt, METRIC_HEAD.length).map(([id, metric, source, threshold, calibration, status]) => ({ id, metric, source, threshold, calibration, status }));
  const limits = width(lt, LIMIT_HEAD.length).map(([id, status, scenes, viewports, raw]) => {
    let value = null;
    try { value = JSON.parse(unwrap(raw)); } catch { errors.push(`${id}: limits cell is not JSON`); }
    return { id, status, scenes: list(scenes), viewports: list(viewports), limits: value };
  });
  const towerLook = md.split('\n').find(l => l.startsWith('**Tower look')) ?? '';
  return { items, metrics, limits, towerLook, errors };
}

export function loadChecklist(file = resolveChecklist()) {
  return parseChecklist(fs.readFileSync(file, 'utf8'));
}

/** Errors (empty = agree): CHECKLIST items complete, Appendix B threshold/status and B.1 limits/scope == thresholds.json. */
export function checkConsistency(checklist, thresholds) {
  const errors = [...checklist.errors], defs = thresholds?.metrics ?? {};
  const have = new Set(checklist.items.map(i => i.id));
  for (const id of ITEM_IDS) if (!have.has(id)) errors.push(`${id} missing in CHECKLIST items`);
  for (const i of checklist.items) for (const k of ['a4', 'a6', 'a8', 'a10']) if (!i[k]) errors.push(`${i.id} anchor ${k.slice(1)} empty`);
  const rows = new Map(checklist.metrics.map(m => [m.id, m])), lim = new Map(checklist.limits.map(m => [m.id, m]));
  const ids = [...new Set([...METRIC_IDS, ...Object.keys(defs), ...rows.keys(), ...lim.keys()])].sort();
  const show = v => JSON.stringify(v);
  for (const id of ids) {
    const def = defs[id], row = rows.get(id), l = lim.get(id);
    if (!METRIC_IDS.includes(id)) errors.push(`${id} is not a metric id`);
    if (!def) { errors.push(`${id} missing in thresholds.json`); continue; }
    if (!row) errors.push(`${id} missing in CHECKLIST Appendix B`);
    else {
      if (row.threshold !== def.threshold) errors.push(`${id} threshold: CHECKLIST ${show(row.threshold)} != thresholds.json ${show(def.threshold)}`);
      if (row.status !== def.status) errors.push(`${id} status: CHECKLIST ${row.status} != thresholds.json ${def.status}`);
    }
    if (!l) { errors.push(`${id} missing in CHECKLIST B.1 machine limits`); continue; }
    if (l.status !== def.status) errors.push(`${id} status (B.1): CHECKLIST ${l.status} != thresholds.json ${def.status}`);
    if (!isDeepStrictEqual(l.scenes, def.scenes)) errors.push(`${id} scenes: CHECKLIST ${show(l.scenes)} != thresholds.json ${show(def.scenes)}`);
    if (!isDeepStrictEqual(l.viewports, def.viewports)) errors.push(`${id} viewports: CHECKLIST ${show(l.viewports)} != thresholds.json ${show(def.viewports)}`);
    if (!isDeepStrictEqual(l.limits, def.limits)) errors.push(`${id} limits: CHECKLIST ${show(l.limits)} != thresholds.json ${show(def.limits)}`);
  }
  return errors;
}

/** Removes metric references (`; M11 passes`, `(M04)`, `, M02 and M16 pass`) so the blind sheet carries no metrics. */
export function stripMetricRefs(text) {
  const ref = String.raw`M\d{2}(?:\(\w+\))?`, refs = String.raw`${ref}(?:\s*(?:and|,|\/)\s*${ref})*`;
  return text
    .replace(new RegExp(String.raw`\s*\(${refs}\)`, 'g'), '')
    .replace(new RegExp(String.raw`[;,]?\s*${refs}(?:\s+pass(?:es)?)?`, 'g'), '')
    .replace(/\s{2,}/g, ' ').trim();
}

/** Items for a scene: the ref-map entry's `items` (scenes appended by later SPs), else the CHECKLIST Scene column. */
export function itemsForScene(checklist, refMap, scene) {
  const entry = refMap?.scenes?.[scene];
  const explicit = entry?.items;
  const items = explicit
    ? checklist.items.filter(i => explicit.includes(i.id))
    : checklist.items.filter(i => i.scenes.includes(scene) || i.scenes.includes('all'));
  if (explicit) for (const id of explicit) if (!checklist.items.some(i => i.id === id)) throw new Error(`ref-map ${scene}: unknown item ${id}`);
  if (!entry && !items.some(i => i.scenes.includes(scene))) throw new Error(`unknown scene ${scene} (not in ref-map.json or the CHECKLIST Scene column)`);
  if (!items.length) throw new Error(`scene ${scene}: no checklist items`);
  return items;
}

/** Blank blind score sheet (Markdown): items with anchors, refs and composite paths; no metrics, scores or code. */
export function scoreSheet({ checklist, refMap, scene, refDir, outDir }) {
  const items = itemsForScene(checklist, refMap, scene), refs = refMap?.scenes?.[scene]?.refs ?? [];
  const lines = [
    `# Blind score sheet: scene \`${scene}\``,
    '',
    'You are scoring a game capture against reference screenshots of the target look. Use only the images listed below and this sheet.',
    '',
    '## Images',
    '',
    `- Composite (current capture | references | detail crops): ${path.join(outDir, `compare-${scene}.png`)}`,
    ...refs.map(r => `- Reference: ${path.join(refDir, r.file)} (${[r.role, r.items?.length ? `only for ${r.items.join(', ')}` : null, r.note].filter(Boolean).join('; ')})`),
    '',
    '## Scale',
    '',
    '- **0-2**: absent or wrong.',
    '- **4**: element exists but reads clearly as the old/placeholder look.',
    '- **6**: right idea, visibly off in proportion/colour/detail.',
    '- **8**: would pass as a sibling of the reference at a glance, minor polish gaps.',
    '- **10**: indistinguishable in style/proportion from the anchor.',
    '',
    'Refs are portrait phone shots: compare **proportions** (ratios, shares, counts, hues), never portrait layout. Tower War references win over City Takeover references, except lane chevrons and the level picker.',
    'Every item scored **8 or higher needs at least 3 concrete observable differences** (what, ref value, ours value); with fewer it is capped at 7.',
    '',
  ];
  if (items.some(i => i.id === 'V05' || i.id === 'V06') && checklist.towerLook) lines.push(checklist.towerLook, '');
  lines.push('## Items', '');
  for (const i of items) {
    lines.push(`### ${i.id}: ${stripMetricRefs(i.item)}`, '', `Anchor refs: ${i.refs}`, '');
    for (const k of ['4', '6', '8', '10']) lines.push(`- **${k}**: ${stripMetricRefs(i[`a${k}`])}`);
    lines.push('', '- score:', '- differences:', '');
  }
  lines.push('## Answer', '', `Write your answer as JSON (\`score-blind-<iter>\`), one entry per item, score 0-10:`, '', '```json', '{');
  items.forEach((i, k) => lines.push(`  "${i.id}": { "score": null, "differences": [] }${k < items.length - 1 ? ',' : ''}`));
  lines.push('}', '```', '');
  return lines.join('\n');
}

function normalise(file, label) {
  const src = file && typeof file === 'object' && file.items && typeof file.items === 'object' ? file.items : file;
  if (!src || typeof src !== 'object') throw new Error(`${label}: not an object`);
  const out = {};
  for (const [id, v] of Object.entries(src)) {
    if (!/^V\d{2}$/.test(id)) continue;
    const score = v?.score ?? null, differences = v?.differences ?? [];
    if (score !== null && (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 10)) throw new Error(`${label} ${id}: score must be 0-10 or null`);
    if (!Array.isArray(differences)) throw new Error(`${label} ${id}: differences must be an array`);
    out[id] = { score, differences: differences.map(String) };
  }
  return out;
}

/** Scoring protocol merge: cap >=8 with <3 differences at 7, item = min(self, blind), flag |self-blind| >= 3. */
export function mergeScores(selfFile, blindFile) {
  const self = normalise(selfFile, 'self'), blind = normalise(blindFile, 'blind');
  const cap = e => (e && e.score !== null && e.score >= 8 && e.differences.length < 3 ? 7 : e?.score ?? null);
  const items = {}, flagged = [], missing = [];
  for (const id of [...new Set([...Object.keys(self), ...Object.keys(blind)])].sort()) {
    const s = self[id], b = blind[id], sc = cap(s), bc = cap(b), flags = [];
    if (sc === null) flags.push('missing-self');
    if (bc === null) flags.push('missing-blind');
    if (s && sc !== s.score && s.score !== null) flags.push('self-capped');
    if (b && bc !== b.score && b.score !== null) flags.push('blind-capped');
    const diff = sc !== null && bc !== null ? Math.abs(s.score - b.score) : null;
    if (diff !== null && diff >= 3) { flags.push('diff>=3'); flagged.push(id); }
    if (sc === null || bc === null) missing.push(id);
    items[id] = { self: sc, selfRaw: s?.score ?? null, blind: bc, blindRaw: b?.score ?? null, merged: sc !== null && bc !== null ? Math.min(sc, bc) : null, diff, flags, differences: { self: s?.differences ?? [], blind: b?.differences ?? [] } };
  }
  return { schema: 1, items, flagged, missing };
}
