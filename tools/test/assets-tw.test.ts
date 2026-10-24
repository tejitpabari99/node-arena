import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { NodeIO, type Document, type Node } from '@gltf-transform/core';
import { Extract, parseJsonExact } from '../src/assets-tw/extract.js';
import { parseObj } from '../src/assets-tw/obj.js';
import { runImport, type ImportResult } from '../src/assets-tw/run.js';
import { OWNED_DIRS, REPO, diffResult, main, writeResult } from '../src/assets-tw/cli.js';
import { twExtractRoot } from '../src/import-tw/env.js';

const EXTRACT = twExtractRoot();
const needExtract = EXTRACT === null || !existsSync(join(EXTRACT, 'catalog/glb_proto')) ? 'TW_EXTRACT not set (private Tower War extract)' : false;

// ---- pure unit tests (no extract) -------------------------------------------------------------------------------------

test('parseObj: RAW conversion undoes UnityPy (x negate, face reversal), keeps UV v flip', () => {
  // UnityPy wrote v=(-x,y,z), faces (c,b,a); original Unity triangle was (0,1,2) with x = 1, 0, 2.
  const obj = ['v -1 0 0', 'v 0 1 0', 'v -2 0 1', 'vt 0.25 0.75', 'vt 0 0', 'vt 1 1', 'vn -1 0 0', 'vn 0 1 0', 'vn -0 0 1', 'f 3/3/3 2/2/2 1/1/1', ''].join('\n');
  const g = parseObj(obj);
  assert.deepEqual([...g.positions], [1, 0, 0, 0, 1, 0, 2, 0, 1]); // x = -obj.x
  assert.deepEqual([...g.normals!], [1, 0, 0, 0, 1, 0, 0, 0, 1]); // -(-0) must not leave a negative zero
  assert.ok([...g.normals!].every((v) => !Object.is(v, -0)) && [...g.positions].every((v) => !Object.is(v, -0)));
  assert.deepEqual([...g.uvs!], [0.25, 0.25, 0, 1, 1, 0]); // (u, 1-v)
  assert.deepEqual([...g.indices], [0, 1, 2]); // OBJ (c,b,a) -> Unity (a,b,c)
  assert.equal(g.triangleCount, 1);
});
test('parseObj: rejects quads and mismatched v/vt/vn indices', () => {
  assert.throws(() => parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nv 1 1 0\nf 1 2 3 4\n'), /triangles/);
  assert.throws(() => parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 0 0\nvt 0 0\nf 1/2/1 2/2/2 3/3/3\n'), /differ/);
});
test('parseJsonExact: unsafe integers (Unity pathIDs) keep their exact digits', () => {
  const v = parseJsonExact('{"a":888743626394437043,"b":4997,"c":-5828095548049259085,"d":1.5}') as Record<string, unknown>;
  assert.deepEqual(v, { a: '888743626394437043', b: 4997, c: '-5828095548049259085', d: 1.5 });
});

function tmp(): string { return mkdtempSync(join(tmpdir(), 'assets-tw-test-')); }

test('runImport: outputs sorted by path, lock lists every input read (sorted, hashed), duplicate outputs rejected', async () => {
  const root = tmp();
  try {
    writeFileSync(join(root, 'b.txt'), 'bee');
    writeFileSync(join(root, 'a.txt'), 'ay');
    const r = await runImport(root, [
      async (ex) => [{ path: 'z.bin', bytes: ex.read('b.txt') }],
      async (ex) => [{ path: 'a.bin', bytes: ex.read('a.txt') }, { path: 'a.bin2', bytes: ex.read('b.txt') }],
    ]);
    assert.deepEqual([...r.files.keys()], ['a.bin', 'a.bin2', 'z.bin']);
    const lock = JSON.parse(r.lock) as { inputs: Record<string, string> };
    assert.deepEqual(Object.keys(lock.inputs), ['a.txt', 'b.txt']);
    assert.equal(lock.inputs['a.txt'], createHash('sha256').update('ay').digest('hex'));
    assert.equal(r.lock, (await runImport(root, [
      async (ex) => [{ path: 'z.bin', bytes: ex.read('b.txt') }],
      async (ex) => [{ path: 'a.bin', bytes: ex.read('a.txt') }, { path: 'a.bin2', bytes: ex.read('b.txt') }],
    ])).lock);
    await assert.rejects(runImport(root, [async () => [{ path: 'x', bytes: new Uint8Array() }], async () => [{ path: 'x', bytes: new Uint8Array() }]]), /duplicate output/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('writeResult/diffResult: identical tree is clean; changed, missing and stale files and a changed lock are reported', () => {
  const dir = tmp();
  try {
    const result: ImportResult = { files: new Map([['models/tw/a.glb', Uint8Array.of(1, 2, 3)], ['textures/tw/a-blue.png', Uint8Array.of(4)], ['fx/x.png', Uint8Array.of(5)]]), lock: '{"format":1}\n' };
    const assets = join(dir, 'assets'), lock = join(dir, 'lock.json');
    writeResult(result, assets, lock, true);
    assert.deepEqual(diffResult(result, assets, lock), []);
    writeFileSync(join(assets, 'models/tw/a.glb'), Uint8Array.of(9));
    rmSync(join(assets, 'fx/x.png'));
    writeFileSync(join(assets, 'textures/tw/old.png'), 'x');
    writeFileSync(lock, 'changed');
    const problems = diffResult(result, assets, lock);
    assert.ok(problems.some((p) => p.startsWith('differs: models/tw/a.glb')));
    assert.ok(problems.some((p) => p === 'missing: fx/x.png'));
    assert.ok(problems.some((p) => p === 'stale (not produced by importer): textures/tw/old.png'));
    assert.ok(problems.some((p) => p.includes('tw-extract.lock.json')));
    writeResult(result, assets, lock, true); // regenerate: prunes the stale file again
    assert.deepEqual(diffResult(result, assets, lock), []);
    assert.deepEqual([...OWNED_DIRS], ['models/tw', 'textures/tw']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('assets:tw and assets:tw:check skip cleanly (exit 0) without TW_EXTRACT', async () => {
  assert.equal(await main([], {}), 0);
  assert.equal(await main(['--check'], {}), 0);
  assert.equal(await main(['--check'], { TW_EXTRACT: '/nonexistent/tw-extract' }), 0);
  assert.equal(await main(['--bogus'], {}), 2);
});

// ---- oracle tests against the Python prototype GLBs (need the private extract) ----------------------------------------------

const r5 = (n: number) => Math.round(n * 1e4) / 1e4;
interface Sig { name: string; tris: number; bbox: string }
function meshSignatures(doc: Document, rename: (n: string) => string | null): Sig[] {
  const sigs: Sig[] = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    const name = rename(node.getName());
    if (!mesh || name === null) continue;
    const m = node.getWorldMatrix();
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let tris = 0;
    for (const prim of mesh.listPrimitives()) {
      tris += prim.getIndices()!.getCount() / 3;
      const pos = prim.getAttribute('POSITION')!.getArray()!;
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i]!, y = pos[i + 1]!, z = pos[i + 2]!;
        for (let k = 0; k < 3; k++) { const v = m[k]! * x + m[4 + k]! * y + m[8 + k]! * z + m[12 + k]!; min[k] = Math.min(min[k]!, v); max[k] = Math.max(max[k]!, v); }
      }
    }
    sigs.push({ name, tris, bbox: [...min, ...max].map(r5).join(',') });
  }
  return sigs.sort((a, b) => (a.name + a.tris + a.bbox < b.name + b.tris + b.bbox ? -1 : 1));
}
const roots = (doc: Document): Node[] => doc.getRoot().listNodes().filter((n) => n.getParentNode() === null);

async function oracle(file: string): Promise<Document> {
  const spec = '../assets/validate/candidate.mjs'; // plain ESM executable spec of the RAW transform (no types)
  const { toRaw } = (await import(spec)) as { toRaw: (src: string, dst: string) => Promise<void> };
  const dir = tmp();
  try {
    const dst = join(dir, 'raw.glb');
    await toRaw(join(EXTRACT!, 'catalog', file), dst);
    const doc = await new NodeIO().read(dst);
    for (const r of roots(doc)) r.setTranslation([0, 0, 0]); // the importer zeroes the prefab root's scene position
    return doc;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const read = (r: ImportResult, p: string): Promise<Document> => new NodeIO().readBinary(r.files.get(p)!);

let cached: Promise<ImportResult> | undefined;
const imported = (): Promise<ImportResult> => (cached ??= runImport(EXTRACT!));

for (const [family, protoFile] of [['soldier', 'glb_proto/1_MilitaryDefaultWarriorSkinData.glb'], ['tank', 'glb_proto/1_MilitaryAttackWarriorSkinData.glb']] as const) {
  test(`oracle: ${family} node count, tri count and per-part bbox match the RAW prototype`, { skip: needExtract }, async () => {
    const mine = await read(await imported(), `models/tw/${family}.glb`), proto = await oracle(protoFile);
    assert.equal(mine.getRoot().listNodes().length, proto.getRoot().listNodes().length, 'node count');
    const keep = (n: string) => n;
    const a = meshSignatures(mine, keep), b = meshSignatures(proto, keep);
    assert.deepEqual(a, b);
    assert.equal(a.reduce((s, x) => s + x.tris, 0), family === 'soldier' ? 1036 : 408);
  });
}

test('soldier LOD1: same part nodes + UV/team texture inputs, 150..450 tris, no clips, no tank LOD', { skip: needExtract }, async () => {
  const r = await imported(), full = await read(r, 'models/tw/soldier.glb'), lod = await read(r, 'models/tw/soldier-lod1.glb');
  const names = (d: Document) => d.getRoot().listNodes().filter((n) => n.getMesh()).map((n) => n.getName());
  assert.deepEqual(names(lod), names(full));
  const tris = lod.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((q, p) => q + p.getIndices()!.getCount() / 3, 0), 0);
  assert.ok(tris >= 150 && tris <= 450, `lod tris ${tris}`);
  for (const m of lod.getRoot().listMeshes()) for (const p of m.listPrimitives()) assert.ok(p.getAttribute('TEXCOORD_0') && p.getAttribute('NORMAL'));
  assert.equal(lod.getRoot().listAnimations().length, 0);
  assert.equal(r.files.has('models/tw/tank-lod1.glb'), false);
});
test('oracle: soldier Run clip equals the prototype Run (RAW values), Death keeps only decoded channels', { skip: needExtract }, async () => {
  const mine = await read(await imported(), 'models/tw/soldier.glb'), proto = await oracle('glb_proto/1_MilitaryDefaultWarriorSkinData.glb');
  const clip = (d: Document, suffix: string) => d.getRoot().listAnimations().find((x) => x.getName().endsWith(suffix))!;
  const chans = (a: ReturnType<typeof clip>) => new Map(a.listChannels().map((c) => [`${c.getTargetNode()!.getName()}:${c.getTargetPath()}`, c.getSampler()!.getOutput()!.getArray()!]));
  const runA = chans(clip(mine, 'Run')), runB = chans(clip(proto, 'Run'));
  assert.equal(runA.size, 26);
  assert.deepEqual([...runA.keys()].sort(), [...runB.keys()].sort());
  for (const [k, arr] of runA) {
    const other = runB.get(k)!;
    assert.equal(arr.length, other.length, k);
    const w = k.endsWith(':rotation') ? 4 : 3;
    for (let i = 0; i < arr.length; i += w) {
      // The catalog's Hermite samples of a quaternion are not unit length; the importer renormalises, the prototype did not.
      const n = w === 4 ? Math.hypot(other[i]!, other[i + 1]!, other[i + 2]!, other[i + 3]!) : 1;
      for (let j = 0; j < w; j++) assert.ok(Math.abs(arr[i + j]! - other[i + j]! / n) < 1e-6, `${k}[${i + j}] ${arr[i + j]} vs ${other[i + j]! / n}`);
    }
  }
  const deathA = chans(clip(mine, 'Death')), deathB = chans(clip(proto, 'Death'));
  for (const [k, arr] of deathA) assert.ok(arr.some((v: number) => v !== 0) && deathB.has(k), `Death ${k} is a real decoded channel`);
  assert.ok(deathA.size < deathB.size, 'all-zero (undecoded constant) channels were omitted');
  assert.equal(clip(mine, 'Run').getExtras()['loop'], true);
  assert.equal(clip(mine, 'Death').getExtras()['loop'], false);
});

test('RAW: node transforms are the prefab values verbatim (no x negate, no quaternion conjugation)', { skip: needExtract }, async () => {
  const doc = await read(await imported(), 'models/tw/soldier.glb');
  const hand = doc.getRoot().listNodes().find((n) => n.getName() === 'hand_right')!;
  assert.deepEqual(hand.getTranslation().map(r5), [-0.4328, 0.8061, 0.0068]);
  assert.deepEqual(hand.getRotation().map(r5), [-0.4343, -0.4739, -0.5648, 0.5175]);
  const body = doc.getRoot().listNodes().find((n) => n.getName() === 'body')!;
  const pos = body.getMesh()!.listPrimitives()[0]!.getAttribute('POSITION')!.getArray()!;
  const objX = readFileSync(join(EXTRACT!, 'assets/defaultlocalgroup_scenes/Mesh/body_4997@sh.obj'), 'utf8').split('\n').find((l) => l.startsWith('v '))!.split(' ');
  assert.ok(Math.abs(pos[0]! + Number(objX[1])) < 1e-6, 'raw x = -obj.x');
});

for (const [family, protoFile, stageMeshes] of [['barracks', 'glb_proto_buildings/House_Default__None_.glb', [310, 470, 630]], ['tower', 'glb_proto_buildings/Tower.glb', [118, 168, 182]]] as const) {
  test(`oracle: ${family} stage0..2 equal the prototype stageMesh_0..2; the prototype double-counts stage 0`, { skip: needExtract }, async () => {
    const mine = await read(await imported(), `models/tw/${family}.glb`), proto = await oracle(protoFile);
    const a = meshSignatures(mine, (n) => (/^stage\d$/.test(n) ? n : null));
    const b = meshSignatures(proto, (n) => (n.startsWith('stageMesh_') ? n.replace('stageMesh_', 'stage') : null));
    assert.deepEqual(a, b);
    assert.deepEqual(a.map((x) => x.tris), stageMeshes);
    assert.equal(meshSignatures(mine, (n) => n).length, 3, 'no mesh on Art');
    assert.equal(meshSignatures(proto, (n) => n).length, 4, 'prototype: Art carries a duplicate of stage 0');
    const root = roots(mine)[0]!;
    assert.deepEqual(root.getExtras()['stageNodes'], [['stage0'], ['stage1'], ['stage2']]);
  });
}

test('oracle: factory parts equal the prototype (minus its three duplicate stageMesh_N nodes); stages are enable-lists', { skip: needExtract }, async () => {
  const mine = await read(await imported(), 'models/tw/factory.glb'), proto = await oracle('glb_proto_buildings/House_Attack__None_.glb');
  const strip = (n: string) => n.replace(/^((?:Second|Third)LevelSmallPipe)_\d+$/, '$1');
  const noStage = (n: string) => (n.startsWith('stageMesh_') ? null : n);
  const dupe = /LevelSmallPipe/;
  // Unique-named parts: identical world-space geometry.
  assert.deepEqual(meshSignatures(mine, (n) => (dupe.test(n) ? null : n)), meshSignatures(proto, (n) => (dupe.test(n) ? null : noStage(n))));
  // The prototype writer links same-path siblings through a path->index dict, so its duplicate-named pipes are orphaned or
  // double-parented: only name + tri counts are comparable for those. Their placement is asserted against the prefab record below.
  const a = meshSignatures(mine, strip).map((s) => (dupe.test(s.name) ? { ...s, bbox: '' } : s));
  assert.deepEqual(a, meshSignatures(proto, noStage).map((s) => (dupe.test(s.name) ? { ...s, bbox: '' } : s)));
  const pipe = mine.getRoot().listNodes().find((n) => n.getName() === 'ThirdLevelSmallPipe_0')!;
  assert.deepEqual(pipe.getTranslation().map(r5), [-0.4706, 1.059, -0.1294]); // prefab lp, RAW
  assert.equal(a.length, 10);
  const stages = roots(mine)[0]!.getExtras()['stageNodes'] as string[][];
  const names = new Set(mine.getRoot().listNodes().map((n) => n.getName()));
  assert.equal(names.size, mine.getRoot().listNodes().length, 'node names unique');
  assert.equal(stages.length, 3);
  for (const s of stages) { assert.ok(s.includes('factory_base')); for (const n of s) assert.ok(names.has(n), n); }
  assert.deepEqual(stages[0], ['factory_base', 'main_pipe1', 'windows_']);
  assert.deepEqual(stages[2], ['factory_base', 'ThirdLevelSmallPipe_0', 'ThirdLevelSmallPipe_1', 'ThirdLevelSmallPipe_2', 'main_pipe1', 'main_pipe2', 'main_pipe3']);
});

test('inventory: exactly the PRD R1 outputs; models embed no texture; textures are original PNG bytes', { skip: needExtract }, async () => {
  const r = await imported();
  const teams5 = ['blue', 'green', 'red', 'yellow', 'gray'], teams4 = ['blue', 'green', 'red', 'yellow'];
  const want = [
    ...['soldier', 'tank', 'barracks', 'factory', 'tower', 'projectile'].map((f) => `models/tw/${f}.glb`), 'models/tw/soldier-lod1.glb',
    ...teams4.flatMap((t) => [`textures/tw/soldier-${t}.png`, `textures/tw/tank-${t}.png`]),
    ...teams5.flatMap((t) => ['barracks', 'factory', 'tower', 'projectile'].map((f) => `textures/tw/${f}-${t}.png`)),
    ...['green', 'snow'].flatMap((t) => [`models/tw/ground-${t}.glb`, `models/tw/obstacle-${t}.glb`, `textures/tw/ground-${t}.png`, `textures/tw/obstacle-${t}.png`]),
    ...['CFX3_T_HollowCircle', 'CFX_T_Star_Add', 'glow_2', 'smoke', 'Spark', 'lane-arrow', 'lane-waveArrow', 'lane-wave', 'lane-trail'].map((f) => `fx/${f}.png`),
    'manifest.tw.json',
  ].sort();
  assert.deepEqual([...r.files.keys()], want);
  for (const [p, bytes] of r.files) {
    if (p.endsWith('.json')) JSON.parse(Buffer.from(bytes).toString('utf8'));
    else if (p.endsWith('.glb')) assert.equal((await new NodeIO().readBinary(bytes)).getRoot().listTextures().length, 0, p);
    else assert.deepEqual([...bytes.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], p);
  }
  const lock = JSON.parse(r.lock) as { inputs: Record<string, string>; outputs: Record<string, string> };
  assert.deepEqual(Object.keys(lock.outputs), [...r.files.keys()], 'lock.outputs lists every generated file, sorted');
  for (const [p, bytes] of r.files) assert.equal(lock.outputs[p], createHash('sha256').update(bytes).digest('hex'), p);
  const keys = Object.keys(lock.inputs);
  assert.deepEqual(keys, [...keys].sort());
  assert.ok(keys.every((k) => !k.startsWith('/') && !k.includes('..')));
  const ex = new Extract(EXTRACT!);
  const sample = 'assets/defaultlocalgroup_scenes/Texture2D/1_DefaultBaseSkinTextureBlue_1167@sh.png';
  assert.equal(lock.inputs[sample], createHash('sha256').update(ex.read(sample)).digest('hex'));
  assert.equal(Buffer.compare(Buffer.from(r.files.get('textures/tw/soldier-blue.png')!), ex.read(sample)), 0, 'PNG bytes copied, not recompressed');
});

const triCount = (doc: Document): number => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + p.getIndices()!.getCount() / 3, 0), 0);
const meshTris = (doc: Document, node: string): number => doc.getRoot().listNodes().find((n) => n.getName() === node)!.getMesh()!.listPrimitives().reduce((k, p) => k + p.getIndices()!.getCount() / 3, 0);

test('env: ground (500-tri budget, 200 tris) and obstacle (300-tri budget) GLBs per theme; textures resized to 256px', { skip: needExtract }, async () => {
  const r = await imported();
  const want = { green: { ground: 200, small: 40, big: 56 }, snow: { ground: 200, small: 66, big: 66 } } as const;
  for (const theme of ['green', 'snow'] as const) {
    const g = await read(r, `models/tw/ground-${theme}.glb`), o = await read(r, `models/tw/obstacle-${theme}.glb`);
    assert.equal(triCount(g), want[theme].ground);
    assert.ok(triCount(g) <= 500);
    assert.equal(meshTris(o, 'small'), want[theme].small);
    assert.equal(meshTris(o, 'big'), want[theme].big);
    assert.ok(want[theme].small <= 300 && want[theme].big <= 300);
    const ge = roots(g)[0]!.getExtras();
    assert.deepEqual(ge['uvRepeat'], [3, 3]);
    assert.deepEqual(ge['uvOffset'], [0, -0.05]);
    assert.equal(ge['wrap'], 'repeat');
    assert.equal(ge['texture'], `ground-${theme}.png`);
    assert.ok(!JSON.stringify(ge['dropped']).includes('Ground'));
    const gm = g.getRoot().listNodes().find((n) => n.getName() === 'ground')!;
    assert.deepEqual(gm.getTranslation(), [0, 0, 0], 'placement is the renderer\'s job');
    for (const tex of [`ground-${theme}`, `obstacle-${theme}`]) {
      const png = r.files.get(`textures/tw/${tex}.png`)!;
      const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
      assert.deepEqual([dv.getUint32(16), dv.getUint32(20)], [256, 256], tex);
    }
  }
  const ge = roots(await read(r, 'models/tw/ground-green.glb'))[0]!;
  assert.deepEqual(ge.listChildren()[0]!.getScale().map(r5), [6, 1, 10]);
  assert.deepEqual(roots(await read(r, 'models/tw/ground-snow.glb'))[0]!.listChildren()[0]!.getScale().map(r5), [18.8618, 1.2009, 15.7]);
});

test('env: Obstacle.prefab 8 children (index = level OCP/OCR/S index) match the frozen collider dump variants and scales', { skip: needExtract }, async () => {
  const colliders = JSON.parse(readFileSync(new URL('../src/import-tw/prefab/colliders.json', import.meta.url), 'utf8')) as { obstacle: { children: { index: number; variant: string; localScale: number[] }[] } };
  const r = await imported();
  for (const theme of ['green', 'snow']) {
    const kids = roots(await read(r, `models/tw/obstacle-${theme}.glb`))[0]!.getExtras()['children'] as { index: number; variant: string; scale: number[] }[];
    assert.equal(kids.length, 8);
    kids.forEach((k, i) => {
      const c = colliders.obstacle.children[i]!;
      assert.equal(k.index, c.index);
      assert.equal(k.variant, c.variant);
      c.localScale.forEach((v, j) => assert.ok(Math.abs(k.scale[j]! - v) < 1e-4, `${theme} child ${i} scale`));
    });
    assert.deepEqual(kids.map((k) => k.variant), ['big', 'small', 'big', 'small', 'big', 'big', 'small', 'small']);
  }
});

test('determinism: two full runs are byte-identical', { skip: needExtract }, async () => {
  const a = await imported(), b = await runImport(EXTRACT!);
  assert.deepEqual([...a.files.keys()], [...b.files.keys()]);
  for (const [p, bytes] of a.files) assert.ok(Buffer.compare(Buffer.from(bytes), Buffer.from(b.files.get(p)!)) === 0, p);
  assert.equal(a.lock, b.lock);
});

test('manifest fragment: deterministic, equals the committed manifest.tw.json, themes registered for green + snow', { skip: needExtract }, async () => {
  const r = await imported();
  const committed = readFileSync(join(REPO, 'apps/web/assets/manifest.tw.json'));
  assert.equal(Buffer.compare(committed, Buffer.from(r.files.get('manifest.tw.json')!)), 0);
  const f = JSON.parse(committed.toString('utf8')) as { themes: Record<string, unknown>; visuals: Record<string, { stages?: unknown[] }> };
  assert.deepEqual(Object.keys(f.themes), ['green', 'snow']);
  for (const id of ['building.house-wt1', 'building.house-wt2', 'building.tower']) assert.equal(f.visuals[id]!.stages!.length, 3, id);
});

// ---- importer scope guard (02-art-overrides Task 2) ---------------------------------------------------------------------

test('writeResult(prune): stale cleanup never touches art/ or manifest.art.json', () => {
  const root = mkdtempSync(join(tmpdir(), 'tw-scope-'));
  try {
    const put = (p: string, s: string) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), s); };
    const art = ['art/models/x.glb', 'art/textures/x.png', 'art/fx/x.json', 'art/audio/x.ogg', 'manifest.art.json', 'manifest.json'];
    for (const p of art) put(p, `keep ${p}`);
    put('models/tw/stale.glb', 'stale');
    put('textures/tw/stale.png', 'stale');
    const r: ImportResult = { files: new Map([['models/tw/fresh.glb', new Uint8Array([1])]]), lock: '{}\n' };
    writeResult(r, root, join(root, 'lock.json'), true);
    assert.equal(existsSync(join(root, 'models/tw/stale.glb')), false, 'owned stale file pruned');
    assert.equal(existsSync(join(root, 'textures/tw/stale.png')), false);
    assert.equal(existsSync(join(root, 'models/tw/fresh.glb')), true);
    for (const p of art) assert.equal(readFileSync(join(root, p), 'utf8'), `keep ${p}`, `${p} intact`);
    assert.deepEqual(diffResult(r, root, join(root, 'lock.json')), [], 'diffResult ignores art files');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
