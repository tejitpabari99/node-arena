// Needs the local Tower War extract (TW_EXTRACT); skipped otherwise (CI has none).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { twExtractRoot } from '../env.js';
import { parseRaw, TwParseError } from '../parse-raw.js';
import { campaignRange, readCampaign } from '../campaign.js';
import { loadPrefabLevels } from '../parse-prefab.js';

const root = twExtractRoot();
const skip = root === null ? 'TW_EXTRACT not set' : false;
const extDir = (): string => join(root as string, 'converted', 'ext');

test('raw -> TwLevel equals converted/ext for every v1-short file; long/boss are refused', { skip }, () => {
  const files = readdirSync(extDir()).filter((f) => f.endsWith('.json')).sort();
  assert.equal(files.length, 14);
  let parsed = 0;
  let refused = 0;
  for (const f of files) {
    const ext = JSON.parse(readFileSync(join(extDir(), f), 'utf8')) as { source: { asset: string; dialect: string; family: string } };
    const asset = ext.source.asset;
    if (ext.source.dialect === 'v1-short' && ext.source.family !== 'LevelViewBoss') {
      assert.deepEqual(parseRaw(root as string, asset), ext, asset);
      parsed++;
    } else {
      assert.throws(() => parseRaw(root as string, asset), (e) => e instanceof TwParseError && /not supported/.test(e.message), asset);
      refused++;
    }
  }
  assert.deepEqual([parsed, refused], [12, 2]);
});

test('campaign order: 1,024 ids, LevelView 1 at 4, prefab levels at 10 and 23', { skip }, () => {
  const entries = readCampaign(root as string);
  assert.equal(entries.length, 1024);
  assert.equal(entries[3]?.id, 'LevelView 1');
  const prefabs = loadPrefabLevels();
  assert.equal(entries.find((e) => e.id === 'LevelView 182_NB')?.position, 10);
  assert.equal(entries.find((e) => e.id === 'LevelView 100_ES')?.position, 23);
  for (const e of campaignRange(entries, 4, 23)) {
    if (prefabs.has(e.id)) continue;
    const lv = parseRaw(root as string, e.id);
    assert.equal(lv.source.dialect, 'v1-short', e.id);
  }
});
