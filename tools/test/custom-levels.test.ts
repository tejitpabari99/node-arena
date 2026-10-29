import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadContent, type ContentFiles } from '@node-arena/content';
import { loadFiles } from '../src/files.js';
import { splitFiles } from '../src/content.js';
import * as levels from '../src/levels.js';
import { parseUnsolved } from '../src/unsolved.js';
import { levelsMarkdown } from '../src/levels-output.js';
import { balance } from '../src/balance.js';
import { serializeLevel } from '../src/import-tw/serialize.js';

const root = resolve(import.meta.dirname, '../..');
const { data, meta } = splitFiles(await loadFiles(resolve(root, 'packages/content')));
const customId = 'na-tooling-test';
function fixture(): ContentFiles {
  const files = structuredClone(data);
  for (const file of Object.keys(files)) if (file.startsWith('data/levels/na-')) delete files[file];
  delete files['data/campaigns/pvp.json'];
  const source = files['data/levels/levelview-1.json']!;
  const level = typeof source === 'string' ? JSON.parse(source) : source;
  files[`data/levels/${customId}.json`] = { ...level, id: customId, name: 'Tooling test' };
  files['data/campaigns/custom.json'] = { $schema: '../../schemas/campaign.schema.json', schemaVersion: '2.0.0', id: 'custom', entries: [{ level: customId, position: 1 }] };
  return files;
}

test('Common stays exactly positions 4–23 while custom levels satisfy the file union and all-selection', () => {
  const files = fixture();
  assert.equal(levels.campaignLevels(files).length, 20);
  assert.deepEqual(levels.campaignLevels(files).map(l => l.position), Array.from({ length: 20 }, (_, i) => i + 4));
  assert.equal(typeof levels.customLevels, 'function');
  assert.deepEqual(levels.customLevels(files), [{ id: customId, position: 1 }]);
  assert.equal(levels.selectLevels(files).levels.length, 21);
  assert.deepEqual(levels.selectLevels(files, customId).levels, [{ id: customId, position: 1 }]);
  delete files[`data/levels/${customId}.json`]; delete files['data/campaigns/custom.json'];
  assert.deepEqual(levels.customLevels(files), []);
  assert.equal(levels.campaignLevels(files).length, 20);
});

test('file union rejects an orphan level and cross-list duplicates', () => {
  const files = fixture();
  delete files['data/campaigns/custom.json'];
  assert.throws(() => levels.campaignLevels(files), /differ/);
  files['data/campaigns/custom.json'] = { $schema: '../../schemas/campaign.schema.json', schemaVersion: '2.0.0', id: 'custom', entries: [{ level: customId, position: 1 }, { level: 'levelview-1', position: 2 }] };
  assert.throws(() => levels.campaignLevels(files), /differ|Common|custom/);
});

test('custom reporting position can be omitted; Common reporting position remains required', () => {
  const compiled = loadContent(fixture()).compiled;
  const custom = levels.validateLevel(compiled[customId]!, undefined, 1, null);
  assert.equal(custom.ok, true, JSON.stringify(custom.errors));
  assert.ok(!('position' in custom));
  assert.match(levelsMarkdown([custom]), /\| — \| na-tooling-test/);
  assert.throws(() => levels.validateLevel(compiled['levelview-1']!, undefined, 1, null), /position/);
});

test('allowlist permits custom position omission only, and validates custom ids against the union', () => {
  const custom = { id: customId, reason: 'test', ownerSignOff: null };
  const list = parseUnsolved([custom]);
  assert.deepEqual(list, [custom]);
  const files = fixture();
  const ids = new Set(levels.selectLevels(files).levels.map(level => level.id));
  for (const entry of list) assert.ok(ids.has(entry.id), entry.id);
  assert.throws(() => parseUnsolved([{ ...custom, id: 'levelview-1' }]), /position/);
  const reports = levels.validateLevels(files, list, customId, 1);
  assert.equal(reports[0]!.ok, true);
  assert.match(reports[0]!.warnings.join(' '), /Now solvable/);
});

test('balance all remains Common-only while explicit custom selection is supported', async () => {
  const files = fixture();
  const common = await balance(files, meta, { levels: 'all', seeds: 1, proxy: 'idle', jobs: 1 });
  assert.equal(common.rows.length, 20);
  assert.ok(common.rows.every(row => row.level.startsWith('levelview-')));
  const custom = await balance(files, meta, { levels: customId, seeds: 1, proxy: '2000', jobs: 1 });
  assert.equal(custom.rows.length, 1); assert.equal(custom.rows[0]!.level, customId);
});

async function cliFixture(run: (dir: string, lock: string, unsolved: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'custom-level-lock-'));
  try {
    await cp(join(root, 'packages/content/data'), join(dir, 'data'), { recursive: true });
    await cp(join(root, 'packages/content/content.json'), join(dir, 'content.json'));
    for (const name of await readdir(join(dir, 'data/levels'))) if (name.startsWith('na-')) await rm(join(dir, 'data/levels', name));
    await rm(join(dir, 'data/campaigns/pvp.json'));
    const files = fixture();
    await writeFile(join(dir, `data/levels/${customId}.json`), JSON.stringify(files[`data/levels/${customId}.json`]));
    await writeFile(join(dir, 'data/campaigns/custom.json'), JSON.stringify(files['data/campaigns/custom.json']));
    const unsolved = join(dir, 'unsolved.json'); await writeFile(unsolved, '[]');
    await run(dir, join(dir, 'levels-lock.json'), unsolved);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const cli = (dir: string, lock: string, unsolved: string, selected: string) => spawnSync(process.execPath,
  ['--import', 'tsx', 'tools/src/cli.ts', 'levels:lock', '--dir', dir, '--lock', lock, '--unsolved', unsolved, '--levels', selected, '--format', 'json'],
  { cwd: root, encoding: 'utf8', timeout: 120000 });

test('levels:lock selected merge reruns only custom and preserves untouched entry bytes', async () => {
  await cliFixture(async (dir, lock, unsolved) => {
    const baseline = await readFile(join(root, 'tools/levels-lock.json'), 'utf8');
    await writeFile(lock, baseline);
    const result = cli(dir, lock, unsolved, customId);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.levels.map((level: { id: string }) => level.id), [customId]);
    const merged = await readFile(lock, 'utf8');
    const entryBytes = (text: string) => [...text.matchAll(/^  "([^"]+)": \{\n(?:.*\n)*?  \}/gm)].map(match => [match[1], match[0]] as const);
    const actual = new Map(entryBytes(merged));
    for (const [id, bytes] of entryBytes(baseline)) assert.equal(actual.get(id), bytes, id);
    assert.equal(Object.keys(JSON.parse(merged)).length, Object.keys(JSON.parse(baseline)).length + 1);
    assert.match(JSON.parse(merged)[customId].finalHash, /^[0-9a-f]{16}$/);
  });
});

test('levels:lock merge refuses missing, malformed and invalid existing locks without overwriting', async () => {
  await cliFixture(async (dir, lock, unsolved) => {
    const missing = cli(dir, lock, unsolved, customId);
    assert.equal(missing.status, 1); assert.match(missing.stdout, /levels-lock|ENOENT/);
    for (const text of ['{oops', '[]', '{"other":{"outcome":"won","ticks":-1,"finalHash":"x"}}']) {
      await writeFile(lock, text);
      const bad = cli(dir, lock, unsolved, customId);
      assert.equal(bad.status, 1, bad.stdout + bad.stderr);
      assert.match(bad.stdout, /lock|JSON/);
      assert.equal(await readFile(lock, 'utf8'), text);
    }
    await writeFile(lock, '{}');
    const unknown = cli(dir, lock, unsolved, 'na-unknown');
    assert.equal(unknown.status, 1); assert.match(unknown.stdout, /Unknown or empty/);
    assert.equal(await readFile(lock, 'utf8'), '{}');
  });
});

test('serializeLevel places editorVersion after name regardless of input key order', () => {
  const level = { theme: 'green', editorVersion: '0.0.7', name: 'Custom', id: 'na-custom', schemaVersion: '2.0.0' };
  const serialized = serializeLevel(level);
  assert.deepEqual(Object.keys(JSON.parse(serialized)), ['schemaVersion', 'id', 'name', 'editorVersion', 'theme']);
  assert.equal(serializeLevel(Object.fromEntries(Object.entries(level).reverse())), serialized);
  assert.equal(serializeLevel(JSON.parse(serialized)), serialized);
});
