import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAjv, next } from '../../src/index.js';

const tex = (n: string) => ({ blue: `${n}_b.png`, green: `${n}_g.png`, red: `${n}_r.png`, yellow: `${n}_y.png`, gray: `${n}_n.png` });
const fixture = () => ({
  $schema: 'schemas/next/manifest.schema.json', schemaVersion: '2.0.0',
  palettes: { blue: '#3355ff', green: '#33aa44', red: '#dd3333', yellow: '#ddcc33', gray: '#888888' },
  visuals: {
    soldier: { kind: 'unit', model: { parts: 'models/tw/soldier.glb', budget: 'unit' }, team: { mode: 'textureSwap', textures: tex('soldier') }, anim: { mode: 'node-tracks', clips: { run: 'Run', death: 'Death' } }, scale: 1 },
    'house-wt1': { kind: 'building', model: { parts: 'models/tw/wt1.glb', budget: 'building' }, stages: [{ mesh: 's0' }, { enable: ['s0', 's1'] }, { mesh: 's2' }], team: { mode: 'textureSwap', textures: tex('wt1') }, scale: 1, label: { height: 1.2 } },
    obstacle: { kind: 'element', model: { parts: 'models/tw/rock.glb', budget: 'obstacle' }, scale: 1 },
  },
  themes: { green: { ground: { mesh: 'g.glb', texture: 'g.png' }, obstacle: { small: 'rs', big: 'rb', texture: 'o.png' }, light: { dir: [1, -2, 1], color: '#ffffff', intensity: 1 }, sky: '#88aaff', fx: ['puff'] } },
  fx: { puff: { texture: 'puff.png', kind: 'burst', params: { count: 8 } } },
  events: { TroopDied: { fx: 'puff', sfx: 'pop' } },
  camera: { pitchDeg: 60, fov: 40, margin: 1 },
});
const catalog = (): next.ManifestCatalog => ({
  archetypes: [{ id: 'house-wt1', visual: 'house-wt1' }], units: [{ id: 'soldier', visual: 'soldier' }], elements: [{ id: 'obstacle', visual: 'obstacle' }],
  levels: [{ id: 'l1', theme: 'green', colorKeys: ['blue', 'red', 'gray'] }], stageThresholds: [10, 30],
});
const validate = createAjv().compile(next.ManifestSchema);
const ok = (m: unknown) => validate(m);
const mutate = (fn: (m: any) => void) => { const m = fixture() as any; fn(m); return m; };

test('version 2.0.0; fixture validates schema + cross-checks', () => {
  assert.equal(next.MANIFEST_SCHEMA_VERSION, '2.0.0');
  assert.equal(ok(fixture()), true, JSON.stringify(validate.errors));
  assert.deepEqual(next.crossCheckManifest(fixture() as any, catalog()), []);
});

test('row: visuals.kind is a registered render kind (open string replaced by defs set)', () => {
  assert.equal(ok(mutate((m) => { m.visuals.soldier.kind = 'tower'; })), false);
  for (const k of ['unit', 'building', 'element', 'ground', 'lane', 'fx']) assert.equal(ok(mutate((m) => { m.visuals.soldier.kind = k; })), true, k);
});

test('row: model {parts,budget in BUDGET_CLASSES}; stages[] has no minLevel', () => {
  assert.equal(ok(mutate((m) => { m.visuals.soldier.model.budget = 'huge'; })), false);
  assert.equal(ok(mutate((m) => { m.visuals.soldier.model = { src: 'x.glb' }; })), false);
  assert.equal(ok(mutate((m) => { m.visuals['house-wt1'].stages[0] = { mesh: 'a', minLevel: 1 }; })), false);
  assert.equal(ok(mutate((m) => { m.visuals['house-wt1'].stages[0] = {}; })), false);
});

test('row: stages length must equal thresholds + 1 (cross-check)', () => {
  const m = mutate((x) => { x.visuals['house-wt1'].stages.pop(); });
  assert.equal(ok(m), true);
  assert.match(next.crossCheckManifest(m, catalog()).join('\n'), /stages length 2 != .*3/);
  assert.deepEqual(next.crossCheckManifest(fixture() as any, { ...catalog(), stageThresholds: [10, 30, 60] }).length, 1);
});

test('row: team textureSwap with blue/green/red/yellow/gray', () => {
  assert.equal(ok(mutate((m) => { m.visuals.soldier.team.mode = 'tint'; })), false);
  assert.equal(ok(mutate((m) => { delete m.visuals.soldier.team.textures.gray; })), false);
  assert.equal(ok(mutate((m) => { m.visuals.soldier.tint = '#ffffff'; })), false);
});

test('row: anim node-tracks with run/death clips; bob removed', () => {
  assert.equal(ok(mutate((m) => { m.visuals.soldier.anim = { mode: 'none' }; })), true);
  assert.equal(ok(mutate((m) => { m.visuals.soldier.anim = { mode: 'node-tracks', clips: { run: 'R' } }; })), false);
  assert.equal(ok(mutate((m) => { m.visuals.soldier.anim = { type: 'bob', hz: 1, amp: 1, sway: 0 }; })), false);
});

test('row: themes shape {ground,obstacle,light,fog?,sky,fx?}; levelVisuals/colorblind/build removed', () => {
  assert.equal(ok(mutate((m) => { delete m.themes.green.obstacle.big; })), false);
  assert.equal(ok(mutate((m) => { m.themes.green.ground = '#00ff00'; })), false);
  assert.equal(ok(mutate((m) => { m.themes.green.fog = { color: '#cccccc', near: 5, far: 40 }; })), true);
  assert.equal(ok(mutate((m) => { m.levelVisuals = {}; })), false);
  assert.equal(ok(mutate((m) => { m.palettes.colorblind = {}; })), false);
  assert.equal(ok(mutate((m) => { m.visuals['house-wt1'].build = 'stacked'; })), false);
});

test('row: fx registry {texture,kind in FX_KINDS,params}; events known and map to fx ids', () => {
  assert.equal(ok(mutate((m) => { m.fx.puff.kind = 'nope'; })), false);
  for (const k of ['sprite', 'ring', 'burst', 'trail']) assert.equal(ok(mutate((m) => { m.fx.puff.kind = k; })), true, k);
  assert.match(next.crossCheckManifest(mutate((m) => { m.events.Bogus = {}; }), catalog()).join(), /Bogus/);
  assert.match(next.crossCheckManifest(mutate((m) => { m.events.TroopDied.fx = 'missing'; }), catalog()).join(), /missing/);
  assert.match(next.crossCheckManifest(mutate((m) => { m.themes.green.fx = ['gone']; }), catalog()).join(), /gone/);
});

test('row: palettes single set incl. gray; camera', () => {
  assert.equal(ok(mutate((m) => { delete m.palettes.gray; })), false);
  assert.equal(ok(mutate((m) => { delete m.camera; })), false);
});

test('row: level -> theme and visuals by kind; colorKey needs texture', () => {
  const c = catalog();
  assert.match(next.crossCheckManifest(fixture() as any, { ...c, levels: [{ id: 'l1', theme: 'snow', colorKeys: [] }] }).join(), /theme "snow"/);
  assert.match(next.crossCheckManifest(fixture() as any, { ...c, archetypes: [{ id: 'a', visual: 'nope' }] }).join(), /visual "nope" not in manifest/);
  assert.match(next.crossCheckManifest(fixture() as any, { ...c, units: [{ id: 'u', visual: 'obstacle' }] }).join(), /kind "element" != "unit"/);
  assert.match(next.crossCheckManifest(fixture() as any, { ...c, levels: [{ id: 'l1', theme: 'green', colorKeys: ['purple'] }] }).join(), /colorKey "purple"/);
  const m = mutate((x) => { delete x.visuals.soldier.team.textures.red; });
  assert.equal(ok(m), false);
});
