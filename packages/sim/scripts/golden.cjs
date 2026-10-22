const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
require('tsx/cjs');
const { scenarios } = require('../test/golden/scenarios.ts');
const { runGoldens } = require('../test/golden/run.ts');
const packageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageRoot, '../..');
const relativeGolden = 'packages/sim/test/golden/baseline.json';
const versionKeys = ['rulesVersion', 'schemaVersion', 'contentVersion'];
function versions(metadata) { return Object.fromEntries(versionKeys.map(key => [key, metadata[key]])); }
function compare(a, b) {
  const valid = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
  if (!valid.test(a) || !valid.test(b)) throw new Error('Invalid golden metadata version');
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
function assertVersionBump(candidate, baseline) {
  if (!baseline) return; // Initial bootstrap only.
  const bumped = versionKeys.filter(key => compare(candidate.metadata[key], baseline.metadata[key]) > 0);
  if (versionKeys.some(key => compare(candidate.metadata[key], baseline.metadata[key]) < 0)) throw new Error('Golden versions must not decrease');
  if (!bumped.length) throw new Error('Golden update requires an increased authoritative version');
  const oldInputs = JSON.stringify(baseline.scenarios), newInputs = JSON.stringify(candidate.scenarios);
  const changedResults = JSON.stringify(baseline.results) !== JSON.stringify(candidate.results);
  // Rules changes with identical fixtures require a rules bump. Fixture data or
  // replay structure changes require the content/schema version respectively.
  if (oldInputs !== newInputs && !bumped.includes('contentVersion') && !bumped.includes('schemaVersion')) throw new Error('Changed golden inputs require a contentVersion or schemaVersion increase');
  if (oldInputs === newInputs && changedResults) {
    const oldHashes = baseline.results.map(r => [r.replay.finalHash, r.eventLogHash]);
    const newHashes = candidate.results.map(r => [r.replay.finalHash, r.eventLogHash]);
    if (JSON.stringify(oldHashes) !== JSON.stringify(newHashes) && !bumped.includes('rulesVersion')) throw new Error('Changed golden behavior requires a rulesVersion increase');
  }
}
function gitBaseline(root, ref, file = relativeGolden) {
  // Invalid/missing refs are errors; only an absent file in a valid commit is bootstrap.
  const revision = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
  try { return JSON.parse(execFileSync('git', ['show', `${revision}:${file}`], { cwd: root, encoding: 'utf8', stdio: 'pipe' })); }
  catch (error) {
    if (String(error.stderr).includes('does not exist in') || String(error.stderr).includes('exists on disk, but not in')) return null;
    throw error;
  }
}
function createBaseline(metadata) {
  return { format: 1, metadata: versions(metadata), scenarios, results: runGoldens(metadata).map(({ events, ...result }) => result) };
}
function updateFile(file, candidate, baselines) {
  for (const baseline of baselines) assertVersionBump(candidate, baseline);
  fs.writeFileSync(file, JSON.stringify(candidate, null, 2) + '\n');
}
function main(args = process.argv.slice(2)) {
  if (args.some(a => a !== '--update')) throw new Error('Usage: pnpm sim:golden [--update]');
  const file = path.join(repoRoot, relativeGolden);
  const metadata = JSON.parse(fs.readFileSync(path.resolve(packageRoot, '../content/content.json'), 'utf8'));
  const guardBase = process.env.VERSION_GUARD_BASE || '';
  const committed = gitBaseline(repoRoot, guardBase || 'HEAD'); // validate the ref before the expensive candidate build
  const candidate = createBaseline(metadata);
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  // VERSION_GUARD_BASE (branch merge-base) overrides the HEAD / HEAD^ comparison refs; unset = unchanged.
  if (guardBase) process.stdout.write(`version guard base: ${guardBase}\n`);
  if (args.includes('--update')) {
    // With VERSION_GUARD_BASE set only the golden at that base constrains the bump (absent there = no constraint);
    // the working-tree file is ignored so repeated regenerations on a branch need no per-run version churn.
    updateFile(file, candidate, guardBase ? [committed] : [existing, committed]);
    process.stdout.write(`${candidate.results.length} golden replays updated\n`);
  } else {
    if (!existing || JSON.stringify(existing) !== JSON.stringify(candidate)) throw new Error('Golden replay baseline differs; version-bump then run pnpm sim:golden --update');
    // Check staged/worktree updates against HEAD, and committed updates against
    // the parent (or CI's explicit merge-base), so hand-editing JSON cannot bypass.
    if (committed && JSON.stringify(existing) !== JSON.stringify(committed)) assertVersionBump(candidate, committed);
    const baseRef = process.env.SIM_GOLDEN_BASE_REF ?? (guardBase || 'HEAD^');
    const base = gitBaseline(repoRoot, baseRef);
    if (base && JSON.stringify(existing) !== JSON.stringify(base)) assertVersionBump(candidate, base);
    process.stdout.write(`${candidate.results.length} golden replays verified (Node)\n`);
  }
}
module.exports = { assertVersionBump, gitBaseline, updateFile, createBaseline };
if (require.main === module) { try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; } }
