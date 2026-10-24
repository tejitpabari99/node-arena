// Manifest v2 asset checks (PRD 07 R3/R4): referenced files exist, committed importer outputs match the hashes recorded in
// tools/assets/tw-extract.lock.json (no TW_EXTRACT needed), triangle budgets per named class, texture size, node/clip names, and the
// manifest equals its merge with manifest.tw.json. Pure over the file system; returns error strings (empty = ok).
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { NodeIO, type Document, type Node } from '@gltf-transform/core';
import { BUDGET_CLASSES, type ManifestV2 } from '@node-arena/content';

import { ART_DIR, OWNED, checkArt, loadArt } from './assets-tw/art-patch.js';
import { ART_PATH, FRAGMENT_PATH, mergeManifest, stringify, type Fragment } from './assets-tw/manifest-fragment.js';

export const MAX_TEXTURE_PX = 256;
export const AUDIO_EXTS = ['.ogg', '.mp3', '.wav'] as const;
export const MAX_AUDIO_BYTES = 1024 * 1024;
export { ART_DIR };

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
const descendants = (roots: Node[]): Node[] => roots.flatMap((n) => [n, ...descendants(n.listChildren())]);
const sceneNodes = (doc: Document): Node[] => descendants((doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0])?.listChildren() ?? []);
const named = (nodes: Node[], name: string): Node | undefined => nodes.find((n) => n.getName() === name);
const meshNodes = (nodes: Node[]): Node[] => nodes.filter((n) => n.getMesh());
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

  // 3. Match each renderer's reference semantics before checking its runtime scene/subtree.
  const modelNodes = async (ref: string, from: string, suffix: boolean, unwrap = false): Promise<{ d: Document; nodes: Node[] } | undefined> => {
    const { file, node } = split(ref);
    if (node !== undefined && (!node || node.includes('#'))) errors.push(`${from}: invalid node suffix in ${ref}`);
    else if (node !== undefined && !suffix) errors.push(`${from}: node suffix is not supported by this renderer (${ref})`);
    if (!present.has(file)) return;
    const d = await doc(file);
    if (!d) return;
    const scene = d.getRoot().getDefaultScene() ?? d.getRoot().listScenes()[0];
    let roots = scene?.listChildren() ?? [];
    if (node !== undefined && suffix) {
      const selected = named(sceneNodes(d), node);
      if (!selected) { errors.push(`${from}: node "${node}" not in ${file}`); return; }
      // Building/projectile factory unwraps a resolved root with exactly one child.
      roots = unwrap && selected.listChildren().length === 1 ? selected.listChildren() : [selected];
    }
    return { d, nodes: descendants(roots) };
  };
  for (const [id, v] of Object.entries(m.visuals)) {
    const selected = await modelNodes(v.model.parts, `visual ${id} model.parts`, v.kind === 'building' || v.kind === 'fx', v.kind === 'building' || v.kind === 'fx');
    if (!selected) continue;
    const { d, nodes } = selected;
    const budget = BUDGET_CLASSES[v.model.budget];
    const staged = new Set((v.stages ?? []).flatMap((s) => ('mesh' in s ? [s.mesh] : s.enable)));
    for (const n of staged) if (!named(nodes, n)) errors.push(`visual ${id}: stage node "${n}" not in ${v.model.parts}`);
    if (id === 'building.tower' && !named(nodes, 'BulletPosition')) errors.push(`visual ${id}: required node "BulletPosition" not in ${v.model.parts}`);
    const baseTris = meshNodes(nodes).filter((n) => !staged.has(n.getName())).reduce((s, n) => s + own(n), 0);
    const variants = v.stages ? v.stages.map((s) => ('mesh' in s ? [s.mesh] : s.enable)) : [[]];
    variants.forEach((names, i) => {
      const tris = baseTris + names.reduce((s, n) => s + (named(nodes, n) ? nodeTris(named(nodes, n)!) : 0), 0);
      if (tris > budget) errors.push(`visual ${id}${v.stages ? ` stage ${i}` : ''}: ${tris} tris > ${v.model.budget} budget ${budget}`);
    });
    if (v.model.lod) {
      const lod = await modelNodes(v.model.lod, `visual ${id} model.lod`, false);
      if (lod) {
        const names = (ns: Node[]) => meshNodes(ns).map((n) => n.getName()).join(',');
        if (names(lod.nodes) !== names(nodes)) errors.push(`visual ${id}: lod ${v.model.lod} part nodes differ from ${v.model.parts}`);
        const lt = meshNodes(lod.nodes).reduce((s, n) => s + own(n), 0), ft = meshNodes(nodes).reduce((s, n) => s + own(n), 0);
        if (lt >= ft) errors.push(`visual ${id}: lod has ${lt} tris, not fewer than ${ft}`);
      }
    }
    if (v.anim?.mode === 'node-tracks') {
      const clips = d.getRoot().listAnimations().map((a) => a.getName());
      for (const c of Object.values(v.anim.clips)) if (!clips.includes(c)) errors.push(`visual ${id}: clip "${c}" not in ${v.model.parts} (has ${clips.join(', ') || 'none'})`);
    }
  }
  for (const [id, t] of Object.entries(m.themes)) {
    const ground = await modelNodes(t.ground.mesh, `theme ${id} ground.mesh`, false);
    if (ground) {
      const { d, nodes } = ground;
      // readGroundPrefab traverses the default scene, taking the first mesh and first family=ground extras.
      const mesh = meshNodes(nodes)[0];
      const scene = d.getRoot().getDefaultScene() ?? d.getRoot().listScenes()[0];
      const extras = [scene?.getExtras(), ...nodes.map((n) => n.getExtras())].find((e) => e?.['family'] === 'ground');
      if (!mesh || !extras) errors.push(`theme ${id} ground: ${t.ground.mesh} has no mesh or ground extras (family="ground")`);
      if (mesh && extras) {
        const finite = (v: unknown) => Number.isFinite(Number(v));
        const positive = (v: unknown) => finite(v) && Number(v) > 0;
        const scale = mesh.getScale();
        if (!positive(scale[0]) || !positive(scale[2])) errors.push(`theme ${id} ground: invalid mesh scale x/z (must be finite and positive)`);
        if (!positive(extras['meshSize'] ?? 10)) errors.push(`theme ${id} ground: invalid meshSize (must be finite and positive)`);
        for (const key of ['uvRepeat', 'uvOffset'] as const) {
          const pair = extras[key];
          // Malformed pairs use renderer defaults; two-element pairs are Number-coerced.
          if (Array.isArray(pair) && pair.length === 2 && !pair.every(key === 'uvRepeat' ? positive : finite)) errors.push(`theme ${id} ground: invalid ${key} (must contain finite${key === 'uvRepeat' ? ' positive' : ''} values)`);
        }
      }
      const tris = mesh ? own(mesh) : 0;
      if (tris > BUDGET_CLASSES.ground) errors.push(`theme ${id} ground: ${tris} tris > ground budget ${BUDGET_CLASSES.ground}`);
    }
    for (const which of ['small', 'big'] as const) {
      const { file, node } = split(t.obstacle[which]);
      if (!present.has(file)) continue;
      const d = await doc(file), n = d && node ? named(sceneNodes(d), node) : undefined;
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
      if (art) errors.push(...checkArt(art, fragment));
      if (stringify(mergeManifest(m as unknown as Record<string, unknown>, fragment, art)) !== stringify(m)) errors.push(`manifest.json is not the merge of itself, ${FRAGMENT_PATH} and ${ART_PATH} (run pnpm assets:manifest)`);
    } catch (e) { errors.push((e as Error).message); }
  }
  return errors;
}
