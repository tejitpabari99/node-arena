import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as content from '../src/index.js';

const envelope = (name: string) => ({ $schema: `${name}.schema.json`, schemaVersion: '1.0.0' as const });
function pack() {
  return {
    'content.json': { ...envelope('content'), contentVersion: '1.0.0', rulesVersion: '1.0.0' },
    'data/balance.json': { ...envelope('balance'), defaults: { timeLimitSec: 300, theme: 'city' } },
    'data/troops/regular.json': { ...envelope('troop'), id: 'regular', visual: 'soldier', value: 1, speed: 10 },
    'data/archetypes/standard.json': { ...envelope('archetype'), id: 'standard', visual: 'tower', footprintRadius: 3, components: { garrison: { cap: 50 }, generates: { troop: 'regular', ratePerSec: 1 }, drawsLines: { extraSlotAbove: [10, 30] }, capturable: {} } },
    'data/bots/easy.json': { ...envelope('bot'), id: 'easy', kind: 'utility', params: { skill: { decisionIntervalSec: 1, noise: 0.1, actionsPerDecision: 1 }, bias: { attack: 1 }, weights: { attack: { targetValue: 10 } } } },
    'data/levels/sample.json': { ...envelope('level'), id: 'sample', name: 'Sample', order: 1, band: 1, bounds: { w: 120, h: 80 }, players: [{ id: 'p1', kind: 'human', colorKey: 'red' }, { id: 'b1', kind: 'bot', colorKey: 'blue', botProfile: 'easy' }], towers: [{ id: 't1', archetype: 'standard', pos: { x: -40, y: 0 }, owner: 'p1', garrison: 10 }, { id: 't2', archetype: 'standard', pos: { x: 40, y: 0 }, owner: 'b1', garrison: 15 }], obstacles: [], mapObjects: [], overrides: {} },
  };
}
const levelFile = 'data/levels/sample.json';
const archetypeFile = 'data/archetypes/standard.json';
function validate(files: content.ContentFileMap, manifest?: object) {
  assert.equal(typeof content.validateContent, 'function', 'shared validator must be exported');
  return content.validateContent(files, manifest ? { manifest } : {});
}
function located(files: content.ContentFileMap, file: string, pointer: string, manifest?: object) {
  const { errors } = validate(files, manifest);
  assert.ok(errors.some((issue) => issue.file === file && issue.pointer === pointer), JSON.stringify(errors));
}

// Removing reference, range, geometry or player checks must allow one of these invalid packs.
test('a valid sample pack validates without forcing twenty campaign levels and remains immutable', () => {
  const files = pack();
  const before = structuredClone(files);
  assert.deepEqual(validate(files), { errors: [], warnings: [] });
  assert.deepEqual(validate(Object.fromEntries(Object.entries(files).map(([file, value]) => [file, JSON.stringify(value)]))), { errors: [], warnings: [] });
  assert.deepEqual(files, before);
  assert.equal((content.loadContent(files)[archetypeFile] as content.Archetype).footprintRadius, 3000);
});

const cases: [string, string, string, (files: ReturnType<typeof pack>) => void][] = [
  ['duplicate player', levelFile, '/players/1/id', f => { f[levelFile].players[1]!.id = 'p1'; }],
  ['duplicate tower', levelFile, '/towers/1/id', f => { f[levelFile].towers[1]!.id = 't1'; }],
  ['unknown tower archetype', levelFile, '/towers/0/archetype', f => { f[levelFile].towers[0]!.archetype = 'missing'; }],
  ['unknown owner', levelFile, '/towers/0/owner', f => { f[levelFile].towers[0]!.owner = 'missing'; }],
  ['unknown troop', archetypeFile, '/components/generates/troop', f => { f[archetypeFile].components.generates.troop = 'missing'; }],
  ['unknown bot', levelFile, '/players/1/botProfile', f => { f[levelFile].players[1]!.botProfile = 'missing'; }],
  ['missing bot', levelFile, '/players/1/botProfile', f => { delete f[levelFile].players[1]!.botProfile; }],
  ['too much garrison', levelFile, '/towers/0/garrison', f => { f[levelFile].towers[0]!.garrison = 51; }],
  ['outside bounds', levelFile, '/towers/0/pos/x', f => { f[levelFile].towers[0]!.pos.x = -61; }],
  ['footprint outside bounds', levelFile, '/towers/0/pos/x', f => { f[levelFile].towers[0]!.pos.x = -59; }],
  ['overlap', levelFile, '/towers/1/pos', f => { f[levelFile].towers[1]!.pos.x = -35; }],
  ['player owns no tower', levelFile, '/players/1/id', f => { f[levelFile].towers[1]!.owner = 'p1'; }],
  ['one owner', levelFile, '/towers', f => { f[levelFile].towers[1]!.owner = 'p1'; }],
  ['no human', levelFile, '/players', f => { f[levelFile].players[0]!.kind = 'bot'; }],
  ['no bot', levelFile, '/players', f => { f[levelFile].players[1]!.kind = 'human'; }],
  ['speed zero', 'data/troops/regular.json', '/speed', f => { f['data/troops/regular.json'].speed = 0; }],
  ['speed too high', 'data/troops/regular.json', '/speed', f => { f['data/troops/regular.json'].speed = 100.001; }],
  ['coordinate limit', levelFile, '/towers/0/pos/x', f => { f[levelFile].towers[0]!.pos.x = 500.001; }],
  ['generation zero', archetypeFile, '/components/generates/ratePerSec', f => { f[archetypeFile].components.generates.ratePerSec = 0; }],
  ['unordered thresholds', archetypeFile, '/components/drawsLines/extraSlotAbove/1', f => { f[archetypeFile].components.drawsLines.extraSlotAbove = [30, 10]; }],
  ['unsupported troop', 'data/troops/regular.json', '/value', f => { f['data/troops/regular.json'].value = 2; }],
];
for (const [name, file, pointer, mutate] of cases) test(`locates ${name}`, () => { const files = pack(); mutate(files); located(files, file, pointer); });

test('aggregates numeric precision and schema errors across fields and files', () => {
  const f = pack();
  f[levelFile].towers[0]!.pos = { x: 0.0001, y: 1.0001 };
  f['data/troops/regular.json'].speed = 0.0001;
  const errors = validate({ ...f, 'broken.json': '{', 'unknown.json': { $schema: 'unknown' }, 'wrong.json': { ...f['data/troops/regular.json'], junk: 1, speed: 0 } }).errors;
  for (const [file, pointer] of [[levelFile, '/towers/0/pos/x'], [levelFile, '/towers/0/pos/y'], ['data/troops/regular.json', '/speed'], ['broken.json', ''], ['unknown.json', '/$schema'], ['wrong.json', '/junk'], ['wrong.json', '/speed']]) assert.ok(errors.some(e => e.file === file && e.pointer === pointer), JSON.stringify(errors));
});

test('default loading checks every reference; explicit partial loading supports isolated tools', () => {
  const f = pack(); f[levelFile].towers[0]!.garrison = 51;
  assert.throws(() => content.loadContent(f), /garrison/);
  assert.throws(() => content.loadContent({ [archetypeFile]: f[archetypeFile] }), /Unknown troop/);
  assert.ok(content.loadContent({ [archetypeFile]: f[archetypeFile] }, { partial: true }));
  located({ [archetypeFile]: f[archetypeFile] }, archetypeFile, '/components/generates/troop');
});

test('explicit teams resolve to player ids and must remain distinct', () => {
  const f = pack();
  const explicit = { ...f, [levelFile]: { ...f[levelFile], players: f[levelFile].players.map(p => ({ ...p, team: p.id })) } };
  Object.assign(f, explicit);
  assert.deepEqual(validate(f).errors, []);
  const players = f[levelFile].players as (typeof f[typeof levelFile]['players'][number] & { team: string })[];
  players[1]!.team = 'missing'; located(f, levelFile, '/players/1/team');
  players[1]!.team = 'p1'; located(f, levelFile, '/players/1/team');
});

test('v1 rejects four bots and each reserved array entry', () => {
  const f = pack();
  f[levelFile].players.push(...Array.from({ length: 3 }, (_, i) => ({ id: `b${i + 2}`, kind: 'bot', colorKey: 'blue', botProfile: 'easy' })));
  located(f, levelFile, '/players');
  located({ ...pack(), [levelFile]: { ...pack()[levelFile], obstacles: [{ kind: 'wall' }], mapObjects: [{ kind: 'gate', pos: { x: -40, y: 0 }, footprintRadius: 1 }] } }, levelFile, '/obstacles/0');
  located({ ...pack(), [levelFile]: { ...pack()[levelFile], mapObjects: [{ kind: 'gate' }] } }, levelFile, '/mapObjects/0');
});

test('inherited archetypes are checked and threshold at cap produces located warning', () => {
  const f = pack();
  const small = { ...f[archetypeFile], id: 'small', extends: 'standard', components: { garrison: { cap: 20 } } };
  const files = { ...f, 'small.json': small, [levelFile]: { ...f[levelFile], towers: f[levelFile].towers.map(t => ({ ...t, archetype: 'small', garrison: 21 })) } };
  located(files, levelFile, '/towers/0/garrison');
  assert.ok(validate(files).warnings.some(e => e.file === archetypeFile && e.pointer === '/components/drawsLines/extraSlotAbove/1'));
  located({ ...f, 'duplicate.json': f[archetypeFile] }, 'duplicate.json', '/id');
  located({ ...f, 'duplicate.json': f['data/troops/regular.json'] }, 'duplicate.json', '/id');
});

test('numeric overrides apply before cap, troop-reference and registry checks', () => {
  const f = pack();
  for (const [overrides, pointer] of [
    [{ archetypes: { standard: { components: { garrison: { cap: 5 } } } } }, '/towers/0/garrison'],
    [{ archetypes: { standard: { components: { generates: { troop: 'missing' } } } } }, '/overrides/archetypes/standard/components/generates/troop'],
    [{ troops: { regular: { value: 2 } } }, '/overrides/troops/regular/value'],
    [{ archetypes: { standard: { components: { drawsLines: { extraSlotAbove: [20, 10] } } } } }, '/overrides/archetypes/standard/components/drawsLines/extraSlotAbove/1'],
    [{ troops: { missing: { speed: 10 } } }, '/overrides/troops/missing'],
    [{ archetypes: { missing: { components: {} } } }, '/overrides/archetypes/missing'],
    [{ archetypes: { standard: { components: { shoots: { radius: 1 } } } } }, '/overrides/archetypes/standard/components/shoots'],
    [{ archetypes: { standard: { components: { garrison: { health: 1 } } } } }, '/overrides/archetypes/standard/components/garrison/health'],
  ] as const) located({ ...f, [levelFile]: { ...f[levelFile], overrides } }, levelFile, pointer);
  const loaded = content.loadContent(f);
  const resolved = content.resolveLevelOverrides(loaded, loaded[levelFile] as content.Level);
  assert.equal(resolved.archetypes.standard?.footprintRadius, 3000);
  assert.equal(resolved.troops.regular?.speed, 10000);
  assert.equal(resolved.globals.timeLimitSec, 300);
});

test('bot resolver inherits weights, rejects depth/cycles/kind mismatch and tooling references', () => {
  const f = pack(); const base = f['data/bots/easy.json'];
  const tier = { ...base, id: 'tier', params: { extends: 'easy', skill: { ...base.params.skill, noise: 0.3 } } };
  const files = { ...f, 'tier.json': tier };
  assert.deepEqual(validate(files).errors, []);
  const resolved = content.resolveProfiles(content.loadContent(files));
  assert.equal(resolved['tier.json']?.params.bias?.attack, 1000);
  assert.equal(resolved['tier.json']?.params.skill?.noise, 300);
  for (const [patch, pointer] of [[{ params: { ...tier.params, extends: 'missing' } }, '/params/extends'], [{ params: { ...tier.params, extends: 'tier' } }, '/params/extends']] as const) located({ ...f, 'tier.json': { ...tier, ...patch } }, 'tier.json', pointer);
  located({ ...f, 'data/bots/easy.json': { ...base, kind: 'idle', params: {} }, 'tier.json': tier }, 'tier.json', '/kind');
  located({ ...files, 'third.json': { ...tier, id: 'third', params: { ...tier.params, extends: 'tier' } } }, 'third.json', '/params/extends');
  for (const id of ['reference', 'human-proxy']) located({ ...f, 'tool.json': { ...base, id }, [levelFile]: { ...f[levelFile], players: f[levelFile].players.map(p => p.kind === 'bot' ? { ...p, botProfile: id } : p) } }, levelFile, '/players/1/botProfile');
  located({ ...f, 'tier.json': { ...tier, params: { ...tier.params, bias: { attack: 1 } } } }, 'tier.json', '/params/bias');
  located({ ...f, 'bad.json': { ...base, id: 'bad', params: { ...base.params, weights: { attack: { targetValue: 10.001 } } } } }, 'bad.json', '/params/weights/attack/targetValue');
});

test('campaign present orders start at one and are unique/contiguous; a full campaign ends at twenty', () => {
  const f = pack(); const sample = f[levelFile];
  const one = 'data/levels/01-first.json'; const two = 'data/levels/02-next.json';
  assert.deepEqual(validate({ ...f, [one]: { ...sample, id: 'one' } }).errors, []);
  located({ ...f, [one]: { ...sample, id: 'one', order: 2 } }, one, '/order');
  located({ ...f, [one]: { ...sample, id: 'one' }, [two]: { ...sample, id: 'two', order: 3 } }, two, '/order');
  located({ ...f, [one]: { ...sample, id: 'one' }, [two]: { ...sample, id: 'two', order: 1 } }, two, '/order');
  const campaign = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`data/levels/${String(i + 1).padStart(2, '0')}-level.json`, { ...sample, id: `level-${i + 1}`, order: i + 1 }]));
  assert.deepEqual(validate({ ...f, ...campaign }).errors, []);
  located({ ...f, [one]: { ...sample, id: 'one', order: 21 } }, one, '/order');
});

function manifest() {
  return { ...envelope('manifest'), palettes: { default: { red: '#ff0000', blue: '#0000ff' }, colorblind: { red: '#ffff00', blue: '#00ffff' } }, teamMarkers: {}, models: { box: { primitive: 'box', size: [1, 1, 1] } }, visuals: { tower: { kind: 'tower', model: 'box', scale: 1 }, soldier: { kind: 'troop', model: 'box', scale: 1 } }, themes: { city: { ground: '#000000', sky: '#ffffff', light: { dir: [1, 1, 1], color: '#ffffff', intensity: 1 } } }, events: {}, camera: { pitchDeg: 45, fov: 50, margin: 0 } };
}

test('optional manifest requires complete shape and checks visuals, every palette and fallback/explicit themes', () => {
  const f = pack(); const m = manifest();
  assert.deepEqual(validate(f, m).errors, []);
  located(f, 'manifest.json', '/camera', { ...m, camera: undefined });
  located(f, archetypeFile, '/visual', { ...m, visuals: { soldier: m.visuals.soldier } });
  located(f, 'data/troops/regular.json', '/visual', { ...m, visuals: { tower: m.visuals.tower } });
  located(f, levelFile, '/players/1/colorKey', { ...m, palettes: { ...m.palettes, colorblind: { red: '#ffffff' } } });
  located(f, 'data/balance.json', '/defaults/theme', { ...m, themes: {} });
  located({ ...f, [levelFile]: { ...f[levelFile], visual: 'missing' } }, levelFile, '/visual', m);
});

test('footprint touching is valid and geometry uses exact milli-unit squared distances', () => {
  const f = pack(); f[levelFile].towers[1]!.pos = { x: -34, y: 0 };
  assert.deepEqual(validate(f).errors, []);
  f[levelFile].towers[1]!.pos = { x: -34.001, y: 0 }; located(f, levelFile, '/towers/1/pos');
});

// A deleted category must never disable otherwise-valid references, including prototype names.
test('deleting all troops/bots/archetypes cannot bypass loader reference checks', () => {
  const f = pack();
  for (const file of ['data/troops/regular.json', 'data/bots/easy.json', archetypeFile]) {
    const omitted = Object.fromEntries(Object.entries(f).filter(([path]) => path !== file));
    assert.throws(() => content.loadContent(omitted), content.ContentLoadError);
  }
  const missing = { ...f, [levelFile]: { ...f[levelFile], towers: f[levelFile].towers.map(t => ({ ...t, archetype: 'constructor' })) } };
  located(missing, levelFile, '/towers/0/archetype');
  located({ ...f, [levelFile]: { ...f[levelFile], overrides: { troops: { constructor: { speed: 1 } }, archetypes: { constructor: { components: {} } } } } }, levelFile, '/overrides/troops/constructor');
});

test('an invalid override does not hide an independent cap violation', () => {
  const f = pack();
  located({ ...f, [levelFile]: { ...f[levelFile], overrides: { troops: { missing: { speed: 1 } }, archetypes: { standard: { components: { garrison: { cap: 5 } } } } } } }, levelFile, '/towers/0/garrison');
});

test('level overrides do not mutate another level or shared loaded entities', () => {
  const f = pack(); const l = { ...f[levelFile], overrides: { archetypes: { standard: { components: { garrison: { cap: 20 } } } }, troops: { regular: { speed: 1.25 } }, globals: { timeLimitSec: 10 } } };
  const loaded = content.loadContent({ ...f, [levelFile]: l }); const before = structuredClone(loaded);
  const result = content.resolveLevelOverrides(loaded, loaded[levelFile] as content.Level);
  assert.equal(result.archetypes.standard?.components.garrison?.cap, 20);
  assert.equal(result.troops.regular?.speed, 1250);
  assert.equal(result.globals.timeLimitSec, 10);
  assert.deepEqual(loaded, before);
  result.archetypes.standard!.components.garrison!.cap = 1;
  assert.deepEqual(loaded, before);
});

test('inherited warning pointers locate authored base thresholds; override warnings locate cap patches', () => {
  const f = pack(); const small = { ...f[archetypeFile], id: 'small', extends: 'standard', components: { garrison: { cap: 20 } } };
  const warnings = validate({ ...f, 'small.json': small }).warnings;
  assert.ok(warnings.some(e => e.file === archetypeFile && e.pointer === '/components/drawsLines/extraSlotAbove/1'), JSON.stringify(warnings));
  const tuned = { ...f, [levelFile]: { ...f[levelFile], overrides: { archetypes: { standard: { components: { garrison: { cap: 20 } } } } } } };
  assert.ok(validate(tuned).warnings.some(e => e.file === levelFile && e.pointer === '/overrides/archetypes/standard/components/garrison/cap'));
});

test('semantic validation remains browser-safe with Node globals absent', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = `const { validateContent } = await import(${JSON.stringify(new URL('../src/index.ts', import.meta.url).href)}); const output = console.log.bind(console); globalThis.process=undefined; globalThis.Buffer=undefined; globalThis.global=undefined; output(JSON.stringify(validateContent(${JSON.stringify(pack())})));`;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { errors: [], warnings: [] });
});

test('override component targets must be own components, including prototype names', () => {
  const f = pack();
  located({ ...f, [levelFile]: { ...f[levelFile], overrides: { archetypes: { standard: { components: { constructor: { cap: 1 } } } } } } }, levelFile, '/overrides/archetypes/standard/components/constructor');
});

test('path-keyed loading preserves source paths named like object prototype properties', () => {
  const f = pack(); const troop = f['data/troops/regular.json'];
  const files = Object.fromEntries([['__proto__', troop], ['constructor', { ...troop, id: 'second' }]]);
  const loaded = content.loadContent(files);
  assert.equal(Object.hasOwn(loaded, '__proto__'), true);
  assert.equal((loaded['__proto__'] as content.Troop).speed, 10000);
  assert.equal((loaded['constructor'] as content.Troop).id, 'second');
});
