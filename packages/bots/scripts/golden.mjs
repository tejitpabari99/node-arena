// Node-only bot golden adapter. Fixtures are JSON data, never executable history.
// Bundle shape matches the sim golden bundle ({metadata, scenarios[{name, level}], results[{name, replay}]}) so
// `pnpm replay:verify golden` (tools/src/replay.ts GOLDEN_DIRS) replays it without running bots.
// Human seat = HUMAN_PROXY (default AI, actionDelayMs 1000): it exercises the same seat-bot path on both sides,
// whereas an idle human would leave the authored AIs un-contested and cover less of the decision code.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BOT_VERSION, runMatch, createSeatBot, HUMAN_PROXY } from '../dist/index.js';
import { canonicalJson, loadContent } from '../../content/dist/index.js';
import { playReplay } from '../../sim/dist/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageRoot, '../..');
const contentRoot = path.resolve(packageRoot, '../content');
const relativeGolden = 'packages/bots/test/golden/bots.json';
export const defaultFile = path.join(repoRoot, relativeGolden);
export const MAX_TICKS = 20000;
export const HUMAN_ACTION_DELAY_MS = 1000;
/** [campaign position, seed]: pos 4 passive AI; pos 6 three AIs with delay+line; pos 11 nested `steps`. */
export const PAIRS = [[4, 1], [6, 2], [11, 3]];

export function loadAuthored() {
  const files = { 'data/balance.json': fs.readFileSync(path.join(contentRoot, 'data/balance.json'), 'utf8') };
  for (const dir of ['units', 'buildings', 'elements', 'campaigns', 'levels']) {
    for (const name of fs.readdirSync(path.join(contentRoot, 'data', dir)).sort()) files[`data/${dir}/${name}`] = fs.readFileSync(path.join(contentRoot, 'data', dir, name), 'utf8');
  }
  const envelope = JSON.parse(fs.readFileSync(path.join(contentRoot, 'content.json'), 'utf8'));
  const metadata = Object.fromEntries(['rulesVersion', 'schemaVersion', 'contentVersion'].map(key => [key, envelope[key]]));
  return { loaded: loadContent(files), metadata };
}

const parse = version => {
  assert.match(String(version), /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/, 'BOT_VERSION must be semver');
  return version.split('.').map(Number);
};
/** previous === undefined is the bootstrap (no committed baseline). Otherwise strictly greater semver is required. */
export function assertUpdate(previous, current) {
  const next = parse(current);
  if (previous === undefined) return;
  const old = parse(previous);
  const index = next.findIndex((value, i) => value !== old[i]);
  assert.ok(index >= 0 && next[index] > old[index], 'BOT_VERSION must increase before updating bot goldens');
}

export function humanIndex(level) {
  const botSeats = new Set(level.bots.map(b => b.player));
  const idx = level.players.findIndex((_, i) => !botSeats.has(i));
  assert.ok(idx >= 0, 'level has no human seat');
  return idx;
}

export function buildBundle() {
  const { loaded, metadata } = loadAuthored();
  const entries = loaded.catalog.campaigns.common.entries;
  const scenarios = [], results = [];
  for (const [position, seed] of PAIRS) {
    const entry = entries.find(e => e.position === position);
    assert.ok(entry, `Missing campaign position ${position}`);
    const level = loaded.compiled[entry.level];
    const name = `pos${position}-${entry.level}-seed-${seed}`;
    const human = humanIndex(level);
    const proxy = createSeatBot(level, seed, human, { ...HUMAN_PROXY, actionDelayMs: HUMAN_ACTION_DELAY_MS });
    const result = runMatch({ level, seed, maxTicks: MAX_TICKS, record: metadata, controllers: [proxy] });
    assert.equal(result.stats.rejected, 0, `${name} rejected commands`);
    assert.ok(result.replay.commands.length > 0, `${name} issued no commands`);
    assert.ok(playReplay({ level, metadata }, result.replay).ok, `${name} replay mismatch`);
    scenarios.push({ name, level, seed, position, humanSeat: human, humanActionDelayMs: HUMAN_ACTION_DELAY_MS, maxTicks: MAX_TICKS });
    results.push({ name, replay: result.replay, commandCount: result.replay.commands.length, outcome: result.outcome, ticks: result.ticks, finalHash: result.stats.finalHash });
  }
  return { botVersion: BOT_VERSION, metadata, botHash: Object.fromEntries(scenarios.map(({ name, level }) => [name, level.botHash])), scenarios, results };
}
export function verifyBundle(expected, actual) {
  assert.equal(canonicalJson(actual), canonicalJson(expected), 'Bot golden outputs differ; investigate, then increase BOT_VERSION and run bots:golden --update');
}
/** Version of the golden at `ref` (default HEAD; VERSION_GUARD_BASE overrides). Absent file in a valid commit = bootstrap. */
export function committedVersion(ref = process.env.VERSION_GUARD_BASE || 'HEAD', root = repoRoot, file = relativeGolden) {
  const revision = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
  try { return JSON.parse(execFileSync('git', ['show', `${revision}:${file}`], { cwd: root, encoding: 'utf8', stdio: 'pipe' })).botVersion; }
  catch (error) {
    if (String(error.stderr).includes('does not exist in') || String(error.stderr).includes('exists on disk, but not in')) return undefined;
    throw error;
  }
}
/** Writes `bundle` over `file` only if bundle.botVersion exceeds every given baseline version. */
export async function updateFile(file, bundle, baselines) {
  for (const version of baselines) assertUpdate(version, bundle.botVersion);
  await writeFile(file, `${JSON.stringify(bundle, null, 2)}\n`);
}
async function main() {
  const args = process.argv.slice(2); let file = defaultFile, update = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--update') update = true;
    else if (args[i] === '--file' && args[i + 1]) file = path.resolve(args[++i]);
    else throw new Error(`Unknown golden argument ${args[i]}`);
  }
  let previous;
  try { previous = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const committed = committedVersion(); // validate the ref before the expensive build
  const bundle = buildBundle();
  if (update) {
    // With VERSION_GUARD_BASE only the golden at that base constrains the bump; otherwise the working file too.
    const baselines = process.env.VERSION_GUARD_BASE ? [committed] : [previous?.botVersion, committed];
    await updateFile(file, bundle, baselines);
  } else {
    assert.ok(previous, 'Missing bot goldens; run bots:golden --update for the initial baseline');
    verifyBundle(previous, bundle);
    // Hand-edited/regenerated golden differing from the committed one must come with a BOT_VERSION increase.
    if (committed !== undefined && canonicalJson(previous) !== canonicalJson(await committedBundle())) assertUpdate(committed, bundle.botVersion);
  }
  console.log(`${update ? 'Updated' : 'Verified'} ${bundle.results.length} bot match goldens at BOT_VERSION ${BOT_VERSION}`);
}
function committedBundle() {
  const ref = process.env.VERSION_GUARD_BASE || 'HEAD';
  return JSON.parse(execFileSync('git', ['show', `${ref}:${relativeGolden}`], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe', maxBuffer: 1 << 28 }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
