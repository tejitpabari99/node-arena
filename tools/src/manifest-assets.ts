// Manifest v2 asset checks (PRD 07 R3/R4): referenced files exist, committed importer outputs match the hashes recorded in
// tools/assets/tw-extract.lock.json (no TW_EXTRACT needed), triangle budgets per named class, texture size, node/clip names, and the
// manifest equals its merge with manifest.tw.json. Pure over the file system; returns error strings (empty = ok).
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NodeIO, type Document, type Node } from '@gltf-transform/core';
import { BUDGET_CLASSES, type ManifestV2 } from '@node-arena/content';

import { loadArt } from './assets-tw/merge-cli.js';
import { ART_PATH, FRAGMENT_PATH, mergeManifest, stringify, type Fragment } from './assets-tw/manifest-fragment.js';

export const MAX_TEXTURE_PX = 256;
/** Directories wholly produced by `assets:tw` (every file must be in the lock's `outputs`). */
const OWNED = ['models/tw', 'textures/tw', 'fx'] as const;

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const split = (ref: string): { file: string; node?: string } => { const i = ref.indexOf('#'); return i < 0 ? { file: ref } : { file: ref.slice(0, i), node: ref.slice(i + 1) }; };

async function walk(base: string, prefix: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(join(base, prefix), { withFileTypes: true }); } catch { return []; }
  const out: string[] = [];
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = `${prefix}/${e.name}`;
    if (e.isDirectory()) out.push(...await walk(base, p)); else if (e.isFile() && !e.name.startsWith('.')) out.push(p);
  }
  return out;
}

function nodeTris(node: Node): number {
  let t = 0;
  for (const p of node.getMesh()?.listPrimitives() ?? []) t += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3;
  for (const c of node.listChildren()) t += nodeTris(c);
  return t;
}
const named = (doc: Document, name: string): Node | undefined => doc.getRoot().listNodes().find((n) => n.getName() === name);
const meshNodes = (doc: Document): Node[] => doc.getRoot().listNodes().filter((n) => n.getMesh());
const own = (n: Node): number => nodeTris(n) - n.listChildren().reduce((s, c) => s + nodeTris(c), 0);
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngSize = (b: Buffer): [number, number] | null => (b.length >= 24 && b.subarray(0, 8).equals(PNG_SIG) ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null);

/** Collect every file path the manifest references, with where it came from. */
function references(m: ManifestV2): Array<{ path: string; from: string; texture?: boolean }> {
  const refs: Array<{ path: string; from: string; texture?: boolean }> = [];
  for (const [id, v] of Object.entries(m.visuals)) {
    refs.push({ path: v.model.parts, from: `visual ${id} model.parts` });
    if (v.model.lod) refs.push({ path: v.model.lod, from: `visual ${id} model.lod` });
    for (const [team, t] of Object.entries(v.team?.textures ?? {})) refs.push({ path: t, from: `visual ${id} texture ${team}`, texture: true });
  }
  for (const [id, t] of Object.entries(m.themes)) {
    refs.push({ path: t.ground.mesh, from: `theme ${id} ground.mesh` }, { path: t.ground.texture, from: `theme ${id} ground.texture`, texture: true });
    refs.push({ path: split(t.obstacle.small).file, from: `theme ${id} obstacle.small` }, { path: split(t.obstacle.big).file, from: `theme ${id} obstacle.big` }, { path: t.obstacle.texture, from: `theme ${id} obstacle.texture`, texture: true });
  }
  for (const [id, f] of Object.entries(m.fx)) refs.push({ path: f.texture, from: `fx ${id}` });
  for (const [id, e] of Object.entries(m.events)) if (e.sfx) refs.push({ path: e.sfx, from: `event ${id} sfx` });
  return refs;
}

export async function checkManifestAssets(m: ManifestV2, assetsDir: string, lockPath?: string): Promise<string[]> {
  const errors: string[] = [];
  const io = new NodeIO();
  const docs = new Map<string, Document>();
  const doc = async (file: string): Promise<Document | undefined> => {
    if (!docs.has(file)) docs.set(file, await io.read(join(assetsDir, file)));
    return docs.get(file);
  };

  // 1. referenced files exist
  const present = new Set<string>();
  for (const r of references(m)) {
    if (existsSync(join(assetsDir, r.path))) present.add(r.path); else errors.push(`${r.from}: file ${r.path} missing`);
  }

  // 2. committed outputs match the lock (no extract needed)
  if (lockPath) {
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { outputs?: Record<string, string> };
    const outputs = lock.outputs ?? {};
    for (const [p, hash] of Object.entries(outputs)) {
      if (!existsSync(join(assetsDir, p))) errors.push(`lock: ${p} missing (run pnpm assets:tw)`);
      else if (sha256(await readFile(join(assetsDir, p))) !== hash) errors.push(`lock: ${p} differs from tw-extract.lock.json (run pnpm assets:tw)`);
    }
    if (Object.keys(outputs).length === 0) errors.push('lock: no outputs recorded (run pnpm assets:tw)');
    for (const dir of OWNED) for (const f of await walk(assetsDir, dir)) if (!(f in outputs)) errors.push(`lock: ${f} is not an importer output (stale or hand-added)`);
  }

  // 3. budgets, textures, node and clip names
  for (const [id, v] of Object.entries(m.visuals)) {
    if (!present.has(v.model.parts)) continue;
    const d = await doc(v.model.parts);
    if (!d) continue;
    const budget = BUDGET_CLASSES[v.model.budget];
    const staged = new Set((v.stages ?? []).flatMap((s) => ('mesh' in s ? [s.mesh] : s.enable)));
    for (const n of staged) if (!named(d, n)) errors.push(`visual ${id}: stage node "${n}" not in ${v.model.parts}`);
    const baseTris = meshNodes(d).filter((n) => !staged.has(n.getName())).reduce((s, n) => s + own(n), 0);
    const variants = v.stages ? v.stages.map((s) => ('mesh' in s ? [s.mesh] : s.enable)) : [[]];
    variants.forEach((names, i) => {
      const tris = baseTris + names.reduce((s, n) => s + (named(d, n) ? nodeTris(named(d, n)!) : 0), 0);
      if (tris > budget) errors.push(`visual ${id}${v.stages ? ` stage ${i}` : ''}: ${tris} tris > ${v.model.budget} budget ${budget}`);
    });
    if (v.model.lod && present.has(v.model.lod)) {
      const l = await doc(v.model.lod);
      if (l) {
        const names = (x: Document) => meshNodes(x).map((n) => n.getName()).join(',');
        if (names(l) !== names(d)) errors.push(`visual ${id}: lod ${v.model.lod} part nodes differ from ${v.model.parts}`);
        const lt = meshNodes(l).reduce((s, n) => s + own(n), 0), ft = meshNodes(d).reduce((s, n) => s + own(n), 0);
        if (lt >= ft) errors.push(`visual ${id}: lod has ${lt} tris, not fewer than ${ft}`);
      }
    }
    if (v.anim?.mode === 'node-tracks') {
      const clips = d.getRoot().listAnimations().map((a) => a.getName());
      for (const c of Object.values(v.anim.clips)) if (!clips.includes(c)) errors.push(`visual ${id}: clip "${c}" not in ${v.model.parts} (has ${clips.join(', ') || 'none'})`);
    }
  }
  for (const [id, t] of Object.entries(m.themes)) {
    if (present.has(t.ground.mesh)) {
      const d = await doc(t.ground.mesh);
      const tris = d ? meshNodes(d).reduce((s, n) => s + own(n), 0) : 0;
      if (tris > BUDGET_CLASSES.ground) errors.push(`theme ${id} ground: ${tris} tris > ground budget ${BUDGET_CLASSES.ground}`);
    }
    for (const which of ['small', 'big'] as const) {
      const { file, node } = split(t.obstacle[which]);
      if (!present.has(file)) continue;
      const d = await doc(file), n = d && node ? named(d, node) : undefined;
      if (!n) errors.push(`theme ${id} obstacle.${which}: node "${node ?? ''}" not in ${file}`);
      else if (nodeTris(n) > BUDGET_CLASSES.obstacle) errors.push(`theme ${id} obstacle.${which}: ${nodeTris(n)} tris > obstacle budget ${BUDGET_CLASSES.obstacle}`);
    }
  }
  for (const r of references(m)) {
    if (!r.texture || !present.has(r.path)) continue;
    const size = pngSize(await readFile(join(assetsDir, r.path)));
    if (!size) { errors.push(`${r.from}: ${r.path} is not a PNG`); continue; }
    const [w, h] = size;
    if (w > MAX_TEXTURE_PX || h > MAX_TEXTURE_PX) errors.push(`${r.from}: ${r.path} is ${w}x${h} > ${MAX_TEXTURE_PX}px`);
  }

  // 4. manifest.json == merge(manifest.json, manifest.tw.json)
  if (!existsSync(join(assetsDir, FRAGMENT_PATH))) errors.push(`${FRAGMENT_PATH} missing`);
  else {
    const fragment = JSON.parse(await readFile(join(assetsDir, FRAGMENT_PATH), 'utf8')) as Fragment;
    try {
      if (stringify(mergeManifest(m as unknown as Record<string, unknown>, fragment, loadArt(assetsDir))) !== stringify(m)) errors.push(`manifest.json is not the merge of itself, ${FRAGMENT_PATH} and ${ART_PATH} (run pnpm assets:manifest)`);
    } catch (e) { errors.push((e as Error).message); }
  }
  return errors;
}
