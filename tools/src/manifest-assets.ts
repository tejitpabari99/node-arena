// Manifest v2 asset checks (PRD 07 R3/R4): referenced files exist, committed importer outputs match the hashes recorded in
// tools/assets/tw-extract.lock.json (no TW_EXTRACT needed), triangle budgets per named class, texture size, node/clip names, and the
// manifest equals its merge with manifest.tw.json. Pure over the file system; returns error strings (empty = ok).
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { NodeIO, type Document, type Node } from '@gltf-transform/core';
import { BUDGET_CLASSES, type ManifestV2 } from '@node-arena/content';

import { loadArt } from './assets-tw/art-patch.js';
import { ART_PATH, FRAGMENT_PATH, mergeManifest, stringify, type Fragment } from './assets-tw/manifest-fragment.js';

export const MAX_TEXTURE_PX = 256;
export const AUDIO_EXTS = ['.ogg', '.mp3', '.wav'] as const;
export const MAX_AUDIO_BYTES = 1024 * 1024;
/** Art-owned manifest paths live under this prefix; exempt from the importer lock walk. */
export const ART_DIR = 'art';
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

/** One file-valued manifest field. `from` is the error label; `ref` = a model ref that may carry a `#node` suffix. */
export interface FileField { owner: string; field: string; path: string; from: string; texture?: boolean; audio?: boolean; ref?: boolean }
/** Every file-valued field of the manifest (scalars such as colours excluded). Shared by the checks and `art:status` so they cannot drift. */
export function fileFields(m: ManifestV2): FileField[] {
  const out: FileField[] = [];
  const add = (owner: string, field: string, path: unknown, o: { from?: string; texture?: boolean; audio?: boolean; ref?: boolean } = {}): void => {
    if (typeof path === 'string') out.push({ owner, field, path, from: o.from ?? `${owner} ${field}`, ...(o.texture ? { texture: true } : {}), ...(o.audio ? { audio: true } : {}), ...(o.ref ? { ref: true } : {}) });
  };
  for (const [id, v] of Object.entries(m.visuals ?? {})) {
    add(id, 'model.parts', v.model?.parts, { from: `visual ${id} model.parts`, ref: true });
    add(id, 'model.lod', v.model?.lod, { from: `visual ${id} model.lod`, ref: true });
    const team = (v.team ?? {}) as { textures?: Record<string, unknown>; base?: unknown; mask?: unknown };
    for (const [k, t] of Object.entries(team.textures ?? {})) add(id, `team.${k}`, t, { from: `visual ${id} texture ${k}`, texture: true });
    for (const k of ['base', 'mask'] as const) add(id, `team.${k}`, team[k], { from: `visual ${id} team.${k}`, texture: true }); // tintMask
  }
  for (const [id, t] of Object.entries(m.themes ?? {})) {
    const o = `theme ${id}`;
    add(o, 'ground.mesh', t.ground?.mesh, { ref: true }); add(o, 'ground.texture', t.ground?.texture, { texture: true });
    add(o, 'obstacle.small', t.obstacle?.small, { ref: true }); add(o, 'obstacle.big', t.obstacle?.big, { ref: true }); add(o, 'obstacle.texture', t.obstacle?.texture, { texture: true });
  }
  for (const [id, f] of Object.entries(m.fx ?? {})) add(`fx ${id}`, 'texture', f.texture, { from: `fx ${id}`, texture: true });
  for (const [id, e] of Object.entries(m.events ?? {})) add(`event ${id}`, 'sfx', e.sfx, { audio: true });
  return out;
}

/** Collect every file path the manifest references, with where it came from. */
interface Ref { path: string; from: string; texture?: boolean; audio?: boolean }
function references(m: ManifestV2): Ref[] {
  return fileFields(m).map((f) => ({ path: f.ref ? split(f.path).file : f.path, from: f.from, ...(f.texture ? { texture: true } : {}), ...(f.audio ? { audio: true } : {}) }));
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Every leaf (scalar or array) of an art patch as a key path; objects recurse. */
function leaves(v: unknown, at: string[] = []): Array<{ at: string[]; value: unknown }> {
  if (!isObj(v)) return [{ at, value: v }];
  return Object.entries(v).flatMap(([k, c]) => (at.length === 0 && (k === '$schema' || k === 'schemaVersion') ? [] : leaves(c, [...at, k])));
}
const hasPath = (root: unknown, at: string[]): boolean => at.every((k) => { if (!isObj(root) || !Object.hasOwn(root, k)) return false; root = root[k]; return true; });

const PATH_KEYS = new Set(['parts', 'lod', 'base', 'mask', 'texture', 'mesh', 'small', 'big', 'sfx']);
const MODEL_REF_KEYS = new Set(['parts', 'lod', 'mesh', 'small', 'big']);
/** Mirrors apps/web assertAssetPath: a safe relative path (no `..`/`.`/empty segment, leading `/`, `\\`, `:?#%` or control chars). */
const unsafePath = (p: string): boolean => !p || p.startsWith('/') || p.includes('\\') || /[:?#%\x00-\x1f]/.test(p) || p.split('/').some((part) => !part || part === '.' || part === '..');

/** Art patch rules: safe paths, no references into importer-owned dirs, and every patched field must still exist in the importer output. */
function checkArt(art: Obj, fragment: Fragment, errors: string[]): void {
  // A `visuals.<id>.team` patch whose `mode` differs from the importer's replaces the whole team object (see deepMerge), so the target is
  // `team` itself and its leaves (e.g. tintMask `base`/`mask`) have no importer counterpart.
  const switched: string[][] = [];
  for (const [id, v] of Object.entries((art['visuals'] ?? {}) as Obj)) {
    const team = isObj(v) ? v['team'] : undefined;
    const base = (fragment.visuals as Record<string, unknown>)[id];
    const baseTeam = isObj(base) ? base['team'] : undefined;
    if (isObj(team) && typeof team['mode'] === 'string' && (!isObj(baseTeam) || team['mode'] !== baseTeam['mode'])) switched.push(['visuals', id, 'team']);
  }
  const under = (at: string[], prefix: string[]): boolean => prefix.every((k, i) => at[i] === k);
  for (const prefix of switched) if (!hasPath(fragment, prefix)) errors.push(`art: ${prefix.join('.')} targets a field the importer no longer produces`);
  for (const { at, value } of leaves(art)) {
    const name = at.join('.');
    const last = at[at.length - 1] ?? '';
    if (typeof value === 'string' && (PATH_KEYS.has(last) || at.includes('textures'))) {
      const file = MODEL_REF_KEYS.has(last) ? value.split('#')[0]! : value;
      if (unsafePath(file)) { errors.push(`art: ${name} is not a safe relative path (${value})`); continue; }
    }
    if (typeof value === 'string') {
      const dir = OWNED.find((d) => value.startsWith(`${d}/`));
      if (dir) errors.push(`art: ${name} points into importer-owned ${dir}/ (${value}); art files must live under ${ART_DIR}/`);
    }
    // events: only `sfx` is patchable and comes from importer defaults (art may add custom events), so there is no fragment target.
    if (switched.some((p) => under(at, p))) continue;
    if (at[0] !== 'events' && !hasPath(fragment, at)) errors.push(`art: ${name} targets a field the importer no longer produces`);
  }
}

/** Errors fail the gate; `warnings` (optional out-param) collects non-failing findings (orphan art files, big audio). */
export async function checkManifestAssets(m: ManifestV2, assetsDir: string, lockPath?: string, warnings: string[] = []): Promise<string[]> {
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

  for (const r of references(m)) {
    if (!r.audio || !present.has(r.path)) continue;
    if (!(AUDIO_EXTS as readonly string[]).includes(extname(r.path).toLowerCase())) errors.push(`${r.from}: ${r.path} must be ${AUDIO_EXTS.join('/')}`);
    else if ((await stat(join(assetsDir, r.path))).size > MAX_AUDIO_BYTES) warnings.push(`${r.from}: ${r.path} is over ${MAX_AUDIO_BYTES / 1024 / 1024} MB`);
  }
  const referenced = new Set(references(m).flatMap((r) => [r.path]));
  for (const f of await walk(assetsDir, ART_DIR)) if (!referenced.has(f)) warnings.push(`art: ${f} is not referenced by the manifest (orphan)`);

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
      const art = loadArt(assetsDir);
      if (art) checkArt(art, fragment, errors);
      if (stringify(mergeManifest(m as unknown as Record<string, unknown>, fragment, art)) !== stringify(m)) errors.push(`manifest.json is not the merge of itself, ${FRAGMENT_PATH} and ${ART_PATH} (run pnpm assets:manifest)`);
    } catch (e) { errors.push((e as Error).message); }
  }
  return errors;
}
