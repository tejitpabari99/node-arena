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

test('replay:verify golden scans all eleven sim and three bot recordings', () => {
  const result = run('replay:verify', 'golden', '--format', 'json');
  assert.equal(result.status, 0, result.stdout); assert.match(result.report.summary, /14 replays verified of 14/);
});
test('golden bundles use authoritative versions and recompute embedded compiled identities', async t => {
  const dir = await directory(t); const file = join(dir, 'baseline.json');
  const original = JSON.parse(await readFile(join(root, 'packages/sim/test/golden/baseline.json'), 'utf8'));
  const bundle = structuredClone(original); bundle.metadata.contentVersion = '9.0.0';
  await writeFile(file, JSON.stringify(bundle)); assert.equal(run('replay:verify', file, '--format', 'json').status, 1);
  bundle.metadata = original.metadata; bundle.scenarios[0].level.towers[0].garrison += 1;
  await writeFile(file, JSON.stringify(bundle)); const result = run('replay:verify', file, '--format', 'json');
  assert.equal(result.status, 1); assert.match(result.report.errors[0].message, /compiled.*hash/i);
});
