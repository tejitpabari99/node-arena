import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { mergeCampaign, parseCampaign, parseCampaignDoc, type CampaignFileEntry, type MergeRow } from '../campaign.js';
import { REMOTE_CONFIG_FILE, TEXTASSET_DIR, twExtractRoot } from '../env.js';
import { REGISTERED_THEMES_PRE_SP07 } from '../gate.js';
import { CAMPAIGN_FILE, defaultContentDir, registeredThemes, runImport } from '../run.js';
import { report, safeTarget } from '../cli.js';
import { FIXTURES, FIXTURE_TEXTASSETS } from './helpers.js';

const fixtureCampaign = parseCampaign(readFileSync(join(FIXTURES, 'remote-config.fixture.json'), 'utf8'));
const e = (position: number, level = `lv-${position}`): CampaignFileEntry => ({ level, position });
const row = (position: number, importable = true): MergeRow => ({ slug: `lv-${position}`, position, importable });
const merge = (existing: CampaignFileEntry[], rows: MergeRow[], skipBlocked = false): CampaignFileEntry[] => mergeCampaign(existing, rows, { skipBlocked, campaign: fixtureCampaign });

test('mergeCampaign: a range after the first level keeps earlier entries (no wipe)', () => {
  const existing = [e(4), e(5), e(6), e(7)];
  assert.deepEqual(merge(existing, [row(8), row(9)]).map((x) => x.position), [4, 5, 6, 7, 8, 9]);
  assert.deepEqual(merge(existing, [row(5, true)]).map((x) => x.level), ['lv-4', 'lv-5', 'lv-6', 'lv-7']);
  // an all-blocked range changes nothing
  assert.deepEqual(merge(existing, [row(8, false), row(9, false)]), existing);
});

test('mergeCampaign: hand-authored entries survive; an importer row on one is an error', () => {
  const existing = [e(4), e(5, 'na-custom'), e(6)];
  const out = merge(existing, [row(4), row(6), row(7)]);
  assert.deepEqual(out.map((x) => x.level), ['lv-4', 'na-custom', 'lv-6', 'lv-7']);
  assert.throws(() => merge(existing, [row(5)]), /hand-authored "na-custom"/);
  // a blocked importer row at a hand-authored position leaves it alone
  assert.deepEqual(merge(existing, [row(5, false)]), existing);
});

test('mergeCampaign: a blocked level ends the contiguous prefix relative to the merged campaign; skipBlocked is sparse', () => {
  const existing = [e(4), e(5), e(6), e(7)];
  // 5 re-imported, 6 blocked: stop; 7 is untouched (kept), 8 not added
  assert.deepEqual(merge(existing, [row(5), row(6, false), row(7), row(8)]).map((x) => x.position), [4, 5, 6, 7]);
  // a row that would leave a gap (9 with no 8) is not added
  assert.deepEqual(merge(existing, [row(9)]).map((x) => x.position), [4, 5, 6, 7]);
  // sparse mode: blocked removed, later rows applied
  assert.deepEqual(merge(existing, [row(6, false), row(9)], true).map((x) => x.position), [4, 5, 7, 9]);
  // first playable level needs no predecessor (tutorials 1-3)
  assert.deepEqual(merge([], [row(4), row(5)]).map((x) => x.position), [4, 5]);
  assert.deepEqual(merge([], [row(5)]), []);
});

test('mergeCampaign: unknown entry fields (e.g. loop) are preserved', () => {
  const out = merge([{ ...e(4), loop: true }], [row(4)]);
  assert.deepEqual(out, [{ level: 'lv-4', position: 4, loop: true }]);
  assert.throws(() => parseCampaignDoc('{"entries":[{"level":"a","position":1},{"level":"b","position":1}]}'), /duplicate position/);
  assert.throws(() => parseCampaignDoc('{}'), /entries/);
});

test('registeredThemes: v2 manifest themes, else the explicit pre-SP07 constant', () => {
  const dir = mkdtempSync(join(tmpdir(), 'na-themes-'));
  try {
    const p = join(dir, 'm.json');
    assert.deepEqual(registeredThemes(p), REGISTERED_THEMES_PRE_SP07);
    writeFileSync(p, JSON.stringify({ schemaVersion: '1.2.0', themes: { grass: {} } }));
    assert.deepEqual(registeredThemes(p), REGISTERED_THEMES_PRE_SP07);
    writeFileSync(p, JSON.stringify({ schemaVersion: '2.0.0', themes: { green: {}, lava: {} } }));
    assert.deepEqual(registeredThemes(p), ['green', 'lava']);
    writeFileSync(p, '{nope');
    assert.deepEqual(registeredThemes(p), REGISTERED_THEMES_PRE_SP07);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('safeTarget refuses paths outside the content dir', () => {
  assert.equal(safeTarget('/x/content', 'data/levels/a.json'), resolve('/x/content/data/levels/a.json'));
  assert.throws(() => safeTarget('/x/content', 'data/../../evil.json'), /outside the content dir/);
  assert.throws(() => safeTarget('/x/content', '/etc/passwd'), /outside the content dir/);
});

/** A throwaway extract (from the committed fixtures) + a copy of the content package. */
function sandbox(): { extract: string; content: string; done: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'na-import-'));
  const extract = join(base, 'extract');
  const content = join(base, 'repo/packages/content');
  mkdirSync(join(extract, TEXTASSET_DIR), { recursive: true });
  mkdirSync(dirname(join(extract, REMOTE_CONFIG_FILE)), { recursive: true });
  cpSync(join(FIXTURES, 'remote-config.fixture.json'), join(extract, REMOTE_CONFIG_FILE));
  cpSync(FIXTURE_TEXTASSETS, join(extract, TEXTASSET_DIR), { recursive: true });
  mkdirSync(content, { recursive: true });
  const src = defaultContentDir();
  cpSync(join(src, 'content.json'), join(content, 'content.json'));
  cpSync(join(src, 'data'), join(content, 'data'), { recursive: true });
  return { extract, content, done: () => rmSync(base, { recursive: true, force: true }) };
}

test('per-level failures do not abort the batch: a missing raw file is blocked with a prefab hint', async () => {
  const sb = sandbox();
  try {
    const r = await runImport({ extractRoot: sb.extract, contentDir: sb.content, range: [4, 6], skipBlocked: true });
    assert.deepEqual(r.rows.map((x) => [x.entry.position, x.result.level !== null]), [[4, true], [5, false], [6, true]]);
    assert.match(r.blocked[0]!.reasons[0]!, /no raw TextAsset file matches.*copy its \.ext\.json from \$TW_EXTRACT\/converted\/ext-prefab/);
    // long / v0 / boss are TwParseErrors too: reported per level, not thrown
    assert.ok(report(r).some((l) => l.startsWith('BLOCKED "LevelView 2_AB"')));
  } finally { sb.done(); }
});

test('campaign merge end to end: --range after 4 keeps 4-23; hand-authored entry kept; blocked range writes no change', async () => {
  const sb = sandbox();
  try {
    const file = join(sb.content, CAMPAIGN_FILE);
    const doc = JSON.parse(readFileSync(file, 'utf8')) as { entries: CampaignFileEntry[] };
    const before = readFileSync(file, 'utf8');
    // re-import 11 only (raw fixture): bytes identical, nothing wiped
    const r = await runImport({ extractRoot: sb.extract, contentDir: sb.content, range: [11, 11] });
    assert.equal(r.files.get(CAMPAIGN_FILE), before);
    assert.equal(r.campaign.length, doc.entries.length);
    // a hand-authored entry inside the list survives and the file stays byte-stable
    doc.entries.splice(3, 0, { level: 'na-custom', position: 99 });
    writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
    const r2 = await runImport({ extractRoot: sb.extract, contentDir: sb.content, range: [11, 11] });
    assert.ok(r2.campaign.some((x) => x.level === 'na-custom' && x.position === 99));
    assert.equal(r2.campaign.length, doc.entries.length);
    // blocked-only range (position 5: raw file missing) leaves the campaign unchanged
    const r3 = await runImport({ extractRoot: sb.extract, contentDir: sb.content, range: [5, 5] });
    assert.deepEqual(r3.campaign, r2.campaign);
    assert.equal(r3.files.size, 1);
  } finally { sb.done(); }
});

test('check mode: default range = importer-owned positions of the committed campaign; orphan level files are stale', async () => {
  const sb = sandbox();
  try {
    writeFileSync(join(sb.content, 'data/levels/levelview-777.json'), '{}\n');
    writeFileSync(join(sb.content, 'data/levels/na-mine.json'), '{}\n');
    const r = await runImport({ extractRoot: sb.extract, contentDir: sb.content, check: true, skipBlocked: true });
    assert.ok(r.rows.length >= 20, `check covered ${r.rows.length} positions`);
    // the fixture extract only has 3 raw levels, so other committed files are orphans here too; what matters is the rule
    assert.ok(r.orphans.includes('data/levels/levelview-777.json'));
    assert.ok(!r.orphans.includes('data/levels/na-mine.json'), 'na- prefix = hand-authored');
    assert.ok(!r.orphans.includes('data/levels/levelview-1.json'), 'produced files are not orphans');
    // explicit ranges and --only never report orphans
    assert.deepEqual((await runImport({ extractRoot: sb.extract, contentDir: sb.content, check: true, range: [4, 6] })).orphans, []);
  } finally { sb.done(); }
});

test('--only normalisation reuses slugify (asset name, slug, spacing and case)', async () => {
  const sb = sandbox();
  try {
    for (const name of ['LevelView 1', 'levelview-1', 'LEVELVIEW_1', 'levelview 1']) {
      const r = await runImport({ extractRoot: sb.extract, contentDir: sb.content, range: [4, 4], only: [name] });
      assert.equal(r.rows.length, 1, name);
      assert.equal(r.files.has(CAMPAIGN_FILE), false);
    }
  } finally { sb.done(); }
});

const root = twExtractRoot();
const skip = root === null ? 'TW_EXTRACT not set' : false;

test('real extract: --range 24-25 is blocked and writes nothing; --range 5-6 does not make common.json stale', { skip }, async () => {
  const dir = defaultContentDir();
  const blocked = await runImport({ extractRoot: root as string, contentDir: dir, range: [24, 25] });
  assert.equal(blocked.blocked.length, 2);
  for (const [path, bytes] of blocked.files) assert.equal(readFileSync(join(dir, path), 'utf8'), bytes, path);
  const mid = await runImport({ extractRoot: root as string, contentDir: dir, range: [5, 6] });
  for (const [path, bytes] of mid.files) assert.equal(readFileSync(join(dir, path), 'utf8'), bytes, path);
  assert.equal(mid.campaign.length, 20);
  const full = await runImport({ extractRoot: root as string, contentDir: dir, check: true });
  assert.equal(full.rows.length, 20);
  assert.deepEqual(full.orphans, []);
});
