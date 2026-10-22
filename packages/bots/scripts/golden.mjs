// Node-only golden adapter. Fixtures are JSON data, never executable history.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import { BOT_VERSION, runMatch } from '../dist/index.js';
import { canonicalJson, hashCompiledLevel } from '../../content/dist/index.js';
import { playReplay } from '../../sim/dist/index.js';
import { compiledCorpus, authoredFiles } from '../test/fixtures/corpus.mjs';

const defaultFile = fileURLToPath(new URL('../test/golden/bots.json', import.meta.url));
const pairs = [['random-6', 1], ['random-0', 37], ['random-3', 704]];
export function assertUpdate(previous, current) {
  const parse = version => {
    assert.match(version, /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/, 'BOT_VERSION must be semver');
    return version.split('.').map(Number);
  };
  const next = parse(current);
  if (previous === undefined) { assert.equal(current, '1.0.0', 'initial BOT_VERSION must be 1.0.0'); return; }
  const old = parse(previous); const index = next.findIndex((value, i) => value !== old[i]);
  assert.ok(index >= 0 && next[index] > old[index], 'BOT_VERSION must increase before updating bot goldens');
}
export async function buildBundle() {
  const corpus = await compiledCorpus(); const files = await authoredFiles();
  const envelope = JSON.parse(files['content.json']);
  const metadata = Object.fromEntries(['rulesVersion', 'schemaVersion', 'contentVersion'].map(key => [key, envelope[key]]));
  const scenarios = [], results = [];
  for (const [id, seed] of pairs) {
    const level = corpus.find(row => row.id === id); assert.ok(level, `Missing golden level ${id}`);
    assert.equal(level.simHash, hashCompiledLevel(level));
    const name = `${id}-seed-${seed}`;
    const result = runMatch({ level, seed, record: metadata });
    assert.notEqual(result.outcome.outcome, 'truncated');
    assert.ok(playReplay({ level, metadata }, result.replay).ok, `${name} replay mismatch`);
    scenarios.push({ name, level, seed });
    results.push({ name, replay: result.replay, commandlog: result.replay.commands, outcome: result.outcome, ticks: result.ticks, finalHash: result.stats.finalHash });
  }
  return { botVersion: BOT_VERSION, metadata, botHash: Object.fromEntries(scenarios.map(({name, level}) => [name, level.botHash])), scenarios, results };
}
export function verifyBundle(expected, actual) {
  assert.equal(canonicalJson(actual), canonicalJson(expected), 'Bot golden outputs differ; investigate, then increase BOT_VERSION and run bots:golden --update');
}
export function committedVersion(file, guardBase = process.env.VERSION_GUARD_BASE || '') {
  // Also guards deletion/replacement of the working fixture. Missing HEAD file is bootstrap.
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: fileURLToPath(new URL('../../..', import.meta.url)), encoding: 'utf8' }).trim();
  // VERSION_GUARD_BASE (branch merge-base) overrides HEAD; unset = unchanged.
  const ref = guardBase
    ? execFileSync('git', ['-C', root, 'rev-parse', '--verify', '--end-of-options', `${guardBase}^{commit}`], { encoding: 'utf8' }).trim()
    : 'HEAD';
  console.log(`version guard base: ${guardBase || 'HEAD'}`);
  const path = relative(root, file).replaceAll('\\', '/');
  if (path.startsWith('../')) return undefined;
  const names = execFileSync('git', ['-C', root, 'ls-tree', '-r', '--name-only', ref, '--', path], { encoding: 'utf8' }).trim();
  if (!names) return undefined;
  return JSON.parse(execFileSync('git', ['-C', root, 'show', `${ref}:${path}`], { encoding: 'utf8' })).botVersion;
}
async function main() {
  const args = process.argv.slice(2); let file = defaultFile, update = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--update') update = true;
    else if (args[i] === '--file' && args[i + 1]) file = resolve(args[++i]);
    else throw new Error(`Unknown golden argument ${args[i]}`);
  }
  let previous;
  try { previous = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (update) {
    const committed = committedVersion(file);
    if (process.env.VERSION_GUARD_BASE) {
      // Branch mode: only the golden at the guard base constrains the version (absent there = no constraint).
      if (committed !== undefined) assertUpdate(committed, BOT_VERSION);
    } else {
      assertUpdate(previous?.botVersion ?? committed, BOT_VERSION);
      if (committed !== undefined) assertUpdate(committed, BOT_VERSION);
    }
  } else assert.ok(previous, 'Missing bot goldens; run bots:golden --update for the initial 1.0.0 baseline');
  const bundle = await buildBundle();
  if (update) await writeFile(file, `${JSON.stringify(bundle, null, 2)}\n`);
  else verifyBundle(previous, bundle);
  console.log(`${update ? 'Updated' : 'Verified'} 3 bot match goldens at BOT_VERSION ${BOT_VERSION}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
