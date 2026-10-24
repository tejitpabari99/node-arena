import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import type { ManifestV2 } from '@node-arena/content';
import { DEFAULT_EVENT_SFX, lightDirFromQuat, lightDirToDataFrame, mergeManifest, stringify, type Fragment } from '../src/assets-tw/manifest-fragment.js';
import { loadArt, mergeFiles } from '../src/assets-tw/merge-cli.js';
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

const FRAG: Fragment = { visuals: { v: { scale: 1, model: { parts: 'a.glb', budget: 'unit' }, stages: [{ mesh: 'x' }, { mesh: 'y' }] } }, themes: { t: { sky: '#000000' } }, fx: { f: { texture: 'f.png', params: { a: 1, b: 2 } } }, events: { Clash: { fx: 'f' } } };
const BASE = { $schema: 's', schemaVersion: '2.0.0', palettes: { gray: '#888888' }, visuals: { old: 1 }, events: { Clash: { sfx: 'stale.ogg', fx: 'stale' }, Gone: { fx: 'x' } }, camera: { fov: 21 } };

test('mergeManifest: idempotent, keeps hand-owned palettes/camera, fragment wins its parts, default sfx replace base sfx, drops stale events', () => {
  const once = mergeManifest(BASE, FRAG);
  assert.deepEqual(Object.keys(once), ['$schema', 'schemaVersion', 'palettes', 'visuals', 'themes', 'fx', 'events', 'camera']);
  assert.deepEqual(once['palettes'], { gray: '#888888' });
  assert.deepEqual(once['camera'], { fov: 21 });
  assert.deepEqual(once['visuals'], FRAG.visuals);
  assert.deepEqual((once['events'] as Record<string, unknown>)['Clash'], { sfx: DEFAULT_EVENT_SFX.Clash, fx: 'f' });
  assert.equal('Gone' in (once['events'] as object), false);
  assert.equal(stringify(mergeManifest(once, FRAG)), stringify(once));
});

test('mergeManifest: no art / empty art is a no-op', () => {
  assert.equal(stringify(mergeManifest(BASE, FRAG, undefined)), stringify(mergeManifest(BASE, FRAG)));
  assert.equal(stringify(mergeManifest(BASE, FRAG, {})), stringify(mergeManifest(BASE, FRAG)));
});

test('mergeManifest: art applies after fragment; objects deep-merge, arrays and scalars replace; inputs untouched', () => {
  const art = { visuals: { v: { scale: 2, model: { parts: 'b.glb' }, stages: [{ mesh: 'z' }] } }, themes: { t: { sky: '#ffffff' } }, fx: { f: { params: { a: 9 } } } };
  const before = JSON.stringify(FRAG);
  const m = mergeManifest(BASE, FRAG, art) as any;
  assert.deepEqual(m.visuals.v.model, { parts: 'b.glb', budget: 'unit' }); // object merge keeps budget
  assert.equal(m.visuals.v.scale, 2); // scalar replace
  assert.deepEqual(m.visuals.v.stages, [{ mesh: 'z' }]); // array replace
  assert.equal(m.themes.t.sky, '#ffffff');
  assert.deepEqual(m.fx.f, { texture: 'f.png', params: { a: 9, b: 2 } });
  assert.equal(JSON.stringify(FRAG), before);
  assert.equal(stringify(mergeManifest(m, FRAG, art)), stringify(m)); // idempotent over its own output
});

test('mergeManifest: art sfx overrides the default; removing it restores the default', () => {
  const withArt = mergeManifest(BASE, FRAG, { events: { Clash: { sfx: 'art/audio/boom.ogg' }, Custom: { sfx: 'art/audio/c.ogg' } } }) as any;
  assert.equal(withArt.events.Clash.sfx, 'art/audio/boom.ogg');
  assert.equal(withArt.events.Clash.fx, 'f');
  assert.equal(withArt.events.Custom.sfx, 'art/audio/c.ogg');
  const restored = mergeManifest(withArt, FRAG) as any;
  assert.equal(restored.events.Clash.sfx, DEFAULT_EVENT_SFX.Clash);
  assert.equal('Custom' in restored.events, false);
});

test('loadArt / assets:manifest: absent = undefined; fixture patch validates and merge stays a fixed point; bad keys rejected', () => {
  const { dir, done } = copy();
  try {
    assert.equal(loadArt(dir), undefined);
    const art = { visuals: { 'unit.tank': { scale: 1.5 } }, events: { Clash: { sfx: 'art/audio/boom.ogg' } } };
    writeFileSync(join(dir, 'manifest.art.json'), JSON.stringify(art));
    assert.deepEqual(loadArt(dir), art);
    assert.equal(mergeFiles(dir).current, false); // manifest.json lacks the patch
    writeFileSync(join(dir, 'manifest.json'), mergeFiles(dir).text);
    assert.equal(mergeFiles(dir).current, true);
    for (const bad of [{ visuals: { 'unit.tank': { kind: 'building' } } }, { visuals: { 'unit.tank': { model: { budget: 'unit' } } } }, { visuals: { 'unit.tank': { scale: null } } }, { palettes: {} }, { camera: { fov: 1 } }, { events: { Clash: { fx: 'x' } } }, { bogus: 1 }]) {
      writeFileSync(join(dir, 'manifest.art.json'), JSON.stringify(bad));
      assert.throws(() => loadArt(dir), /manifest\.art\.json invalid/, JSON.stringify(bad));
    }
  } finally { done(); }
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
