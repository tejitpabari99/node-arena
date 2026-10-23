import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import type { ManifestV2 } from '@node-arena/content';
import { lightDirFromQuat, lightDirToDataFrame, mergeManifest, stringify, type Fragment } from '../src/assets-tw/manifest-fragment.js';
import { mergeFiles } from '../src/assets-tw/merge-cli.js';
import { checkManifestAssets } from '../src/manifest-assets.js';

const root = resolve(import.meta.dirname, '../..');
const ASSETS = join(root, 'apps/web/assets');
const LOCK = join(root, 'tools/assets/tw-extract.lock.json');
const load = (dir = ASSETS): ManifestV2 => JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as ManifestV2;
function copy(): { dir: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'na-assets-'));
  cpSync(ASSETS, dir, { recursive: true });
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('committed manifest: files, lock hashes (no extract), budgets, textures, clips and fragment merge all pass', async () => {
  assert.deepEqual(await checkManifestAssets(load(), ASSETS, LOCK), []);
});

test('check:manifest CLI passes with TW_EXTRACT unset', () => {
  const env = { ...process.env }; delete env['TW_EXTRACT'];
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'tools/src/cli.ts', 'check:manifest', '--format', 'json'], { cwd: root, encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal((JSON.parse(r.stdout) as { ok: boolean }).ok, true);
});

test('a changed or stale importer output is reported against the lock', async () => {
  const { dir, done } = copy();
  try {
    writeFileSync(join(dir, 'textures/tw/soldier-blue.png'), 'tampered');
    writeFileSync(join(dir, 'models/tw/extra.glb'), 'x');
    const errors = (await checkManifestAssets(load(dir), dir, LOCK)).join('\n');
    assert.match(errors, /lock: textures\/tw\/soldier-blue\.png differs/);
    assert.match(errors, /soldier-blue\.png is not a PNG/);
    assert.match(errors, /lock: models\/tw\/extra\.glb is not an importer output/);
  } finally { done(); }
});

test('missing referenced file, unknown stage node and unknown clip are reported', async () => {
  const { dir, done } = copy();
  try {
    const m = load(dir) as any;
    m.visuals['unit.soldier'].anim.clips.run = 'Walk';
    m.visuals['building.tower'].stages[0] = { mesh: 'nope' };
    m.fx['capture-ring'].texture = 'fx/missing.png';
    const errors = (await checkManifestAssets(m, dir)).join('\n');
    assert.match(errors, /clip "Walk" not in models\/tw\/soldier\.glb/);
    assert.match(errors, /stage node "nope" not in models\/tw\/tower\.glb/);
    assert.match(errors, /fx capture-ring: file fx\/missing\.png missing/);
  } finally { done(); }
});

test('triangle budgets are enforced per named class (unit 1100, building 1200, obstacle 300, ground 500)', async () => {
  const m = load() as any;
  m.visuals['unit.tank'].model.budget = 'obstacle'; // tank has 408 tris
  m.visuals['building.house-wt1'].model.budget = 'obstacle'; // barracks stage 2 is 630 + others
  const errors = (await checkManifestAssets(m, ASSETS)).join('\n');
  assert.match(errors, /visual unit\.tank: 408 tris > obstacle budget 300/);
  assert.match(errors, /visual building\.house-wt1 stage \d: \d+ tris > obstacle budget 300/);
  const ok = await checkManifestAssets(load(), ASSETS);
  assert.deepEqual(ok.filter((e) => /budget/.test(e)), []);
});

test('texture size above 256px is rejected', async () => {
  const { dir, done } = copy();
  try {
    // a 512x512 PNG header is enough for the size check; hash check is skipped (no lock passed)
    const png = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png); png.writeUInt32BE(13, 8); png.write('IHDR', 12); png.writeUInt32BE(512, 16); png.writeUInt32BE(512, 20);
    writeFileSync(join(dir, 'textures/tw/tank-red.png'), png);
    assert.match((await checkManifestAssets(load(dir), dir)).join('\n'), /tank-red\.png is 512x512 > 256px/);
  } finally { done(); }
});

test('mergeManifest: idempotent, keeps hand-owned parts (sfx, palettes, camera), fragment wins its parts, drops stale fx', () => {
  const frag: Fragment = { visuals: { v: { a: 1 } }, themes: { t: {} }, fx: { f: {} }, events: { Clash: { fx: 'f' } } };
  const base = { $schema: 's', schemaVersion: '2.0.0', palettes: { gray: '#888888' }, visuals: { old: 1 }, events: { Clash: { sfx: 'audio/clash.ogg', fx: 'stale' }, LineCut: { sfx: 'audio/cut.ogg' }, Gone: { fx: 'x' } }, camera: { fov: 21 } };
  const once = mergeManifest(base, frag);
  assert.deepEqual(once, { $schema: 's', schemaVersion: '2.0.0', palettes: { gray: '#888888' }, visuals: { v: { a: 1 } }, themes: { t: {} }, fx: { f: {} }, events: { Clash: { sfx: 'audio/clash.ogg', fx: 'f' }, LineCut: { sfx: 'audio/cut.ogg' } }, camera: { fov: 21 } });
  assert.deepEqual(Object.keys(once), ['$schema', 'schemaVersion', 'palettes', 'visuals', 'themes', 'fx', 'events', 'camera']);
  assert.equal(stringify(mergeManifest(once, frag)), stringify(once));
});

test('committed manifest.json is a fixed point of its merge with manifest.tw.json', () => {
  assert.equal(mergeFiles(ASSETS).current, true);
});

test('lightDirFromQuat: TW directional light (quat 0.5016,0.3786,-0.2589,0.7335) points down; dir is toward the light', () => {
  const d = lightDirFromQuat([0.5016, 0.3786, -0.2589, 0.7335]);
  assert.ok(d[1] > 0.9, `toward-light y is up: ${d}`);
  assert.ok(Math.abs(Math.hypot(...d) - 1) < 1e-3, 'unit length');
  assert.deepEqual(lightDirFromQuat([0, 0, 0, 1]), [0, 0, -1]);
});

test('lightDirToDataFrame: raw Unity (x,z) -> data frame (z,-x) quarter turn; y and length unchanged', () => {
  assert.deepEqual(lightDirToDataFrame([1, 0, 0]), [0, 0, -1]);
  assert.deepEqual(lightDirToDataFrame([0, 1, 0]), [0, 1, 0]);
  assert.deepEqual(lightDirToDataFrame([0, 0, 1]), [1, 0, 0]);
  const d = lightDirToDataFrame(lightDirFromQuat([0.5016, 0.3786, -0.2589, 0.7335]));
  assert.deepEqual(d, [-0.2101, 0.9319, 0.2957]);
});
