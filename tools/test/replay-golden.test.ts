import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
function run(command: string, ...args: string[]) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tools/src/cli.ts', command, ...args], { cwd: root, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, report: args.includes('json') ? JSON.parse(result.stdout) : undefined };
}
async function directory(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), 'arena-rules-replay-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('replay:verify golden scans all fifteen v2 sim recordings (bots goldens rejoin with SP06)', () => {
  const result = run('replay:verify', 'golden', '--format', 'json');
  assert.equal(result.status, 0, result.stdout); assert.match(result.report.summary, /15 replays verified of 15/);
});
test('corrupted golden fixtures fail with a clear message (tampered finalHash, tampered command)', async t => {
  const dir = await directory(t); const file = join(dir, 'baseline.json');
  const original = JSON.parse(await readFile(join(root, 'packages/sim/test/golden/baseline.json'), 'utf8'));
  const bad = structuredClone(original); bad.results[1].replay.finalHash = '0'.repeat(16);
  await writeFile(file, JSON.stringify(bad));
  let result = run('replay:verify', file, '--format', 'json');
  assert.equal(result.status, 1); assert.match(result.report.errors[0].message, /Replay mismatch; first diverging tick: 70/);
  assert.equal(result.report.errors[0].pointer, '/results/1/replay');
  const cmd = structuredClone(original); cmd.results[0].replay.commands[0].tick += 1;
  await writeFile(file, JSON.stringify(cmd));
  result = run('replay:verify', file, '--format', 'json');
  assert.equal(result.status, 1); assert.match(result.report.errors[0].message, /Replay mismatch|Invalid or incompatible replay/);
});
test('golden bundles use authoritative versions and recompute embedded compiled identities', async t => {
  const dir = await directory(t); const file = join(dir, 'baseline.json');
  const original = JSON.parse(await readFile(join(root, 'packages/sim/test/golden/baseline.json'), 'utf8'));
  const bundle = structuredClone(original); bundle.metadata.contentVersion = '9.0.0';
  await writeFile(file, JSON.stringify(bundle)); assert.equal(run('replay:verify', file, '--format', 'json').status, 1);
  bundle.metadata = original.metadata; bundle.scenarios[0].level.timeLimitSec = 99;
  await writeFile(file, JSON.stringify(bundle)); const result = run('replay:verify', file, '--format', 'json');
  assert.equal(result.status, 1); assert.match(result.report.errors[0].message, /simHash is stale/i);
});
