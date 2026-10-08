import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { compileLevel, generateHashes, loadContent, validateContent, type Archetype, type ContentFileMap, type Level, type Troop } from '../src/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
function authoredFiles(): ContentFileMap {
  const files: ContentFileMap = {};
  if (existsSync(join(root, 'content.json'))) files['content.json'] = JSON.parse(readFileSync(join(root, 'content.json'), 'utf8'));
  for (const entry of readdirSync(join(root, 'data'), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const path = join(entry.parentPath, entry.name);
    files[path.slice(root.length)] = JSON.parse(readFileSync(path, 'utf8'));
  }
  assert.ok(files['data/levels/sample.json'], 'shipped dataset must provide a compilable sample level');
  return files;
}

// Missing metadata/entities or broken references must prevent the shipped sample
// from reaching the same compiler boundary as other consumers.
test('shipped sample validates and compiles to usable integer simulation inputs', () => {
  const files = authoredFiles();
  assert.deepEqual(validateContent(files), { errors: [], warnings: [] });
  const level = compileLevel(loadContent(files), 'sample');
  assert.equal(level.timeLimitSec, 300);
  assert.equal(level.visual, 'theme.downtown');
  assert.deepEqual(level.bounds, { w: 120000, h: 80000 });
  assert.deepEqual(level.players.map(({ id, kind, team }) => ({ id, kind, team })), [
    { id: 'b1', kind: 'bot', team: 'b1' }, { id: 'p1', kind: 'human', team: 'p1' },
  ]);
  assert.deepEqual(level.towers.map(({ id, x, y, owner, garrison }) => ({ id, x, y, owner, garrison })), [
    { id: 't1', x: -40000, y: 0, owner: 1, garrison: 10 },
    { id: 't2', x: 40000, y: 0, owner: 0, garrison: 10 },
    { id: 't3', x: 0, y: 0, owner: -1, garrison: 15 },
  ]);
  assert.deepEqual(level.kinds, [{ id: 'regular', value: 1, speedMilli: 10000, visual: 'troop.regular' }]);
  assert.deepEqual(level.bots, [{ player: 0, profile: { id: 'sample-bot', kind: 'idle', params: {} } }]);
  assert.deepEqual((files['data/levels/sample.json'] as Level).overrides, {});
  assert.match(level.simHash, /^[a-f0-9]{64}$/);
  assert.match(level.botHash['sample-bot'] ?? '', /^[a-f0-9]{64}$/);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'hashes.lock.json'), 'utf8')), generateHashes(loadContent(files)));
});

// A missing inheritance patch or lost base component breaks the named variant's
// usable simulation behavior; placeholder balance numbers can still be tuned.
test('shipped small and large variants preserve base behavior with distinct capacities and generation', () => {
  const files = authoredFiles();
  assert.deepEqual(validateContent(files).errors, []);
  const compileVariant = (archetype: string) => {
    const variantFiles = structuredClone(files);
    (variantFiles['data/levels/sample.json'] as Level).towers[2]!.archetype = archetype;
    return compileLevel(loadContent(variantFiles), 'sample').towers[2]!;
  };
  const standard = compileVariant('standard');
  const small = compileVariant('small');
  const large = compileVariant('large');
  for (const variant of [small, large]) {
    assert.deepEqual(Object.keys(variant.components).sort(), ['capturable', 'drawsLines', 'garrison', 'generates']);
    assert.equal(variant.components.generates!.troop, 0);
  }
  assert.ok(small.components.garrison!.cap! < standard.components.garrison!.cap!);
  assert.ok(large.components.garrison!.cap! > standard.components.garrison!.cap!);
  assert.ok(small.components.generates!.ratePerSec! < standard.components.generates!.ratePerSec!);
  assert.ok(large.components.generates!.ratePerSec! > standard.components.generates!.ratePerSec!);
  assert.ok(small.footprintRadius < standard.footprintRadius);
  assert.ok(large.footprintRadius > standard.footprintRadius);
});

// Real data edits must flow into the compiler and identity without a code edit.
test('valid sample balance edits change simulation identity while reskins preserve it', () => {
  const files = authoredFiles();
  assert.deepEqual(validateContent(files).errors, []);
  const original = compileLevel(loadContent(files), 'sample');
  const mutations = [
    (data: ContentFileMap) => { (data['data/troops/regular.json'] as Troop).speed = 12; },
    (data: ContentFileMap) => { (data['data/archetypes/standard.json'] as Archetype).components.generates!.ratePerSec = 1.25; },
    (data: ContentFileMap) => { (data['data/levels/sample.json'] as Level).towers[0]!.pos.x = -35; },
  ];
  for (const mutate of mutations) {
    const edited = structuredClone(files);
    mutate(edited);
    assert.deepEqual(validateContent(edited).errors, []);
    assert.notEqual(compileLevel(loadContent(edited), 'sample').simHash, original.simHash);
  }
  const reskin = structuredClone(files);
  (reskin['data/levels/sample.json'] as Level).name = 'Reskinned sample';
  (reskin['data/archetypes/standard.json'] as Archetype).visual = 'tower.other';
  assert.equal(compileLevel(loadContent(reskin), 'sample').simHash, original.simHash);
});
