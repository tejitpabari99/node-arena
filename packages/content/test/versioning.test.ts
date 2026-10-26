import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as content from '../src/index.js';
import { dataOnly, hashFixture } from './hash-fixture.js';

const hashesOf = (files: Record<string, any>) => content.generateHashes(content.loadContent(dataOnly(files)));

// A regenerated lock must not hide unversioned balance drift against the baseline.
test('regenerating hashes still rejects a semantic edit without an increasing content version', () => {
  const files = hashFixture();
  files['content.json'].contentVersion = '2.0.0';
  const baseline = { metadata: { contentVersion: files['content.json'].contentVersion as string }, hashes: hashesOf(files) };
  const changed = structuredClone(files);
  changed['data/units/soldier.json'].speed = 7;
  const hashes = hashesOf(changed);
  const metadata = { contentVersion: changed['content.json'].contentVersion as string };
  assert.throws(() => content.checkContentVersion(metadata, hashes, baseline), /contentVersion/);
  metadata.contentVersion = '1.9.9';
  assert.throws(() => content.checkContentVersion(metadata, hashes, baseline), /contentVersion/);
  metadata.contentVersion = '2.0.1';
  assert.doesNotThrow(() => content.checkContentVersion(metadata, hashes, baseline));
});

test('lock shape: levels keyed by id, bots keyed by "<levelId>#<playerId>"', () => {
  const files = hashFixture();
  const hashes = hashesOf(files);
  assert.ok('levelview-1' in hashes.levels);
  assert.ok(Object.keys(hashes.bots).length > 0);
  for (const key of Object.keys(hashes.bots)) {
    assert.match(key, /^[a-z0-9-]+#[a-z0-9-]+$/);
    const [level, player] = key.split('#');
    assert.ok(files[`data/levels/${level}.json`].players.some((seat: { id: string; bot?: unknown }) => seat.id === player && seat.bot), key);
  }
});

test('bot-only edits have separate lock identity and do not require a content version bump', () => {
  const files = hashFixture(); const hashes = hashesOf(files);
  const baseline = { metadata: { contentVersion: '2.0.0' }, hashes };
  const seat = files['data/levels/levelview-1.json'].players.find((p: any) => p.bot);
  seat.bot.behavior = seat.bot.behavior === 'full' ? 'attackOnly' : 'full';
  const changed = hashesOf(files);
  assert.deepEqual(changed.levels, hashes.levels);
  assert.notDeepEqual(changed.bots, hashes.bots);
  assert.doesNotThrow(() => content.checkContentVersion(baseline.metadata, changed, baseline));
});

test('level removal requires version bump; no baseline always passes', () => {
  const hashes = hashesOf(hashFixture());
  const baseline = { metadata: { contentVersion: '2.0.0' }, hashes };
  assert.throws(() => content.checkContentVersion(baseline.metadata, { levels: {}, bots: hashes.bots }, baseline), /contentVersion/);
  assert.doesNotThrow(() => content.checkContentVersion(baseline.metadata, hashes));
});

test('content.json is validated against the content schema; baselines only need contentVersion', () => {
  assert.equal(content.parseContentMeta({ ...hashFixture()['content.json'], contentVersion: '2.0.0' }).contentVersion, '2.0.0');
  assert.throws(() => content.parseContentMeta({ ...hashFixture()['content.json'], schemaVersion: '1.0.0' }), content.ContentLoadError);
  assert.throws(() => content.parseContentMeta({ ...hashFixture()['content.json'], contentVersion: '2.0' }), content.ContentLoadError);
  assert.deepEqual(content.readBaselineVersion('{"schemaVersion":"1.0.0","contentVersion":"1.1.6","x":1}'), { contentVersion: '1.1.6' });
  assert.throws(() => content.readBaselineVersion('{}'), /contentVersion/);
});

test('rules header, exported constant and content metadata must agree', () => {
  assert.doesNotThrow(() => content.checkRulesVersion(`RULES_VERSION: ${content.RULES_VERSION}\n`, content.RULES_VERSION));
  assert.throws(() => content.checkRulesVersion('RULES_VERSION: 1.0.0\n', '1.0.0'), /RULES_VERSION/);
  assert.throws(() => content.checkRulesVersion(`RULES_VERSION: ${content.RULES_VERSION}\n`, '99.0.1'), /rulesVersion/);
  assert.throws(() => content.checkRulesVersion('no header', '1.0.0'), /RULES_VERSION/);
});

test('editorVersion metadata preserves compiled levels and content/bot hash locks without a version bump', () => {
  const files = hashFixture();
  const before = content.loadContent(dataOnly(files));
  const hashes = content.generateHashes(before);
  const metadata = { contentVersion: files['content.json'].contentVersion as string };
  for (const editorVersion of ['0.0.1', '0.0.2']) {
    files['data/levels/levelview-1.json'].editorVersion = editorVersion;
    const after = content.loadContent(dataOnly(files));
    assert.deepEqual(after.compiled, before.compiled);
    const changed = content.generateHashes(after);
    assert.deepEqual(changed, hashes);
    assert.doesNotThrow(() => content.checkContentVersion(metadata, changed, { metadata, hashes }));
  }
});
