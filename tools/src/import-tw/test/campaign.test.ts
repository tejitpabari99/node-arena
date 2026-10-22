import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { campaignRange, parseCampaign } from '../campaign.js';
import { FIXTURES } from './helpers.js';

const fixture = (): string => readFileSync(join(FIXTURES, 'remote-config.fixture.json'), 'utf8');

test('campaign position is the 1-based index; tutorials occupy 1-3', () => {
  const entries = parseCampaign(fixture());
  assert.deepEqual(entries.slice(0, 3).map((e) => [e.id, e.position, e.isTutor]), [['3TutorLevel', 1, true], ['4TutorLevel', 2, true], ['2TutorLevel', 3, true]]);
  assert.deepEqual(entries[3], { id: 'LevelView 1', position: 4, isTutor: false });
  assert.equal(entries.find((e) => e.id === 'LevelView 20')?.position, 22);
});

test('campaignRange 4-23 yields 20 entries in order', () => {
  const r = campaignRange(parseCampaign(fixture()), 4, 23);
  assert.equal(r.length, 20);
  assert.equal(r[0]?.id, 'LevelView 1');
  assert.equal(r[19]?.position, 23);
  assert.throws(() => campaignRange(parseCampaign(fixture()), 4, 99), /only 25 entries/);
  assert.throws(() => campaignRange([], 0, 3), /bad campaign range/);
});

test('levels may be an inline array or object; duplicates and bad shapes error', () => {
  const wrap = (levels: unknown): string => JSON.stringify({ game_settings: { levels } });
  assert.equal(parseCampaign(wrap([{ id: 'A' }])).length, 1);
  assert.equal(parseCampaign(wrap({ levels: [{ id: 'A' }, { id: 'B' }] })).length, 2);
  assert.throws(() => parseCampaign(wrap([{ id: 'A' }, { id: 'A' }])), /duplicate level id/);
  assert.throws(() => parseCampaign(wrap([{ nope: 1 }])), /no string id/);
  assert.throws(() => parseCampaign('{}'), /game_settings missing/);
  assert.throws(() => parseCampaign(wrap(5)), /not a list/);
});
