import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as content from '../src/index.js';
import { hashFixture } from './hash-fixture.js';

// A regenerated lock must not hide unversioned balance drift against the baseline.
test('regenerating hashes still rejects a semantic edit without an increasing content version', () => {
  assert.equal(typeof content.generateHashes, 'function');
  const files = hashFixture();
  const baseline = { metadata: files['content.json'] as content.Content, hashes: content.generateHashes(content.loadContent(files)) };
  const changed = structuredClone(files);
  (changed['data/troops/regular.json'] as content.Troop).speed = 12;
  const hashes = content.generateHashes(content.loadContent(changed));
  const metadata = changed['content.json'] as content.Content;
  assert.throws(() => content.checkContentVersion(metadata, hashes, baseline), /contentVersion/);
  metadata.contentVersion = '0.9.9';
  assert.throws(() => content.checkContentVersion(metadata, hashes, baseline), /contentVersion/);
  metadata.contentVersion = '1.0.1';
  assert.doesNotThrow(() => content.checkContentVersion(metadata, hashes, baseline));
});

test('bot-only edits have separate lock identity and defer BOT_VERSION enforcement to SP04', () => {
  assert.equal(typeof content.generateHashes, 'function');
  const files = hashFixture(); const hashes = content.generateHashes(content.loadContent(files));
  const baseline = { metadata: files['content.json'] as content.Content, hashes };
  (files['data/bots/base.json'] as content.BotProfile).params.bias!.attack = 2;
  const changed = content.generateHashes(content.loadContent(files));
  assert.deepEqual(changed.levels, hashes.levels);
  assert.notDeepEqual(changed.bots, hashes.bots);
  assert.equal(Object.keys(changed.bots).length, 2, 'lock includes even unreferenced base profiles');
  assert.doesNotThrow(() => content.checkContentVersion(baseline.metadata, changed, baseline));
});

test('level removal and addition require version bump; first dataset can bootstrap', () => {
  assert.equal(typeof content.checkContentVersion, 'function');
  const files = hashFixture(); const metadata = files['content.json'] as content.Content;
  const hashes = content.generateHashes(content.loadContent(files));
  const baseline = { metadata, hashes };
  assert.throws(() => content.checkContentVersion(metadata, { levels: {}, bots: hashes.bots }, baseline), /contentVersion/);
  assert.doesNotThrow(() => content.checkContentVersion(metadata, hashes));
});

test('rules header, exported constant and content metadata must agree', () => {
  assert.equal(typeof content.checkRulesVersion, 'function');
  assert.doesNotThrow(() => content.checkRulesVersion('RULES_VERSION: 1.0.0\n', '1.0.0'));
  assert.throws(() => content.checkRulesVersion('RULES_VERSION: 2.0.0\n', '2.0.0'), /RULES_VERSION/);
  assert.throws(() => content.checkRulesVersion('RULES_VERSION: 1.0.0\n', '1.0.1'), /rulesVersion/);
  assert.throws(() => content.checkRulesVersion('no header', '1.0.0'), /RULES_VERSION/);
});
