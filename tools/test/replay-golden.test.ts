import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { verifyReplays } from '../src/replay.js';

const root = resolve(import.meta.dirname, '../..');
const contentDir = join(root, 'packages/content');
/** Temp repo root whose golden dir holds `bundle`; the `golden` alias is the only path that honours embedded levels. */
async function goldenRoot(t: { after(fn: () => Promise<void>): void }, bundle: unknown) {
  const dir = await directory(t); await mkdir(join(dir, 'packages/sim/test/golden'), { recursive: true }); await mkdir(join(dir, 'packages/bots/test/golden'), { recursive: true });
  await writeFile(join(dir, 'packages/sim/test/golden/baseline.json'), JSON.stringify(bundle)); return dir;
}
function run(command: string, ...args: string[]) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tools/src/cli.ts', command, ...args], { cwd: root, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, report: args.includes('json') ? JSON.parse(result.stdout) : undefined };
}
async function directory(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), 'arena-rules-replay-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('replay:verify golden scans all 22 v2 recordings (sim + bots goldens)', () => {
  const result = run('replay:verify', 'golden', '--format', 'json');
  assert.equal(result.status, 0, result.stdout); assert.match(result.report.summary, /22 replays verified of 22/);
});
test('corrupted golden fixtures fail with a clear message (tampered finalHash, tampered command)', async t => {
  const original = JSON.parse(await readFile(join(root, 'packages/sim/test/golden/baseline.json'), 'utf8'));
  const bad = structuredClone(original); bad.results[1].replay.finalHash = '0'.repeat(16);
  let result = await verifyReplays('golden', contentDir, await goldenRoot(t, bad));
  assert.equal(result.errors.length, 1); assert.match(result.errors[0]!.message, /Replay mismatch; first diverging tick: 70/);
  assert.equal(result.errors[0]!.pointer, '/results/1/replay');
  const cmd = structuredClone(original); cmd.results[0].replay.commands[0].tick += 1;
  result = await verifyReplays('golden', contentDir, await goldenRoot(t, cmd));
  assert.equal(result.errors.length, 1); assert.match(result.errors[0]!.message, /Replay mismatch|Invalid or incompatible replay/);
});
test('golden bundles use authoritative versions and recompute embedded compiled identities', async t => {
  const original = JSON.parse(await readFile(join(root, 'packages/sim/test/golden/baseline.json'), 'utf8'));
  const bundle = structuredClone(original); bundle.metadata.contentVersion = '9.0.0';
  assert.ok((await verifyReplays('golden', contentDir, await goldenRoot(t, bundle))).errors.length > 0);
  bundle.metadata = original.metadata; bundle.scenarios[0].level.timeLimitSec = 99;
  const result = await verifyReplays('golden', contentDir, await goldenRoot(t, bundle));
  assert.match(result.errors[0]!.message, /simHash is stale/i);
});
test('golden bundles passed as an arbitrary path are refused (embedded levels only via the golden alias)', async t => {
  const dir = await directory(t); const file = join(dir, 'baseline.json');
  await writeFile(file, await readFile(join(root, 'packages/sim/test/golden/baseline.json'), 'utf8'));
  const result = run('replay:verify', file, '--format', 'json');
  assert.equal(result.status, 1); assert.match(result.report.errors[0].message, /only through the `golden` alias/);
});
test('crafted golden bundle with hostile level numbers fails fast with a clear error (no hang or huge allocation)', async t => {
  const bundle = JSON.parse(await readFile(join(root, 'packages/sim/test/golden/baseline.json'), 'utf8'));
  bundle.scenarios[0].level.rules.aliveCap = 2 ** 31 - 1;
  const { computeSimHash } = await import('@node-arena/content');
  const { simHash: _stale, botHash: _bot, ...rest } = bundle.scenarios[0].level;
  bundle.scenarios[0].level.simHash = computeSimHash(rest); // self-consistent hashes: only createState bounds can stop it
  for (const r of bundle.results) if (r.name === bundle.scenarios[0].name) r.replay.header.simHash = bundle.scenarios[0].level.simHash;
  const started = Date.now();
  const result = await verifyReplays('golden', contentDir, await goldenRoot(t, bundle));
  assert.ok(Date.now() - started < 5000);
  assert.ok(result.errors.some(e => /aliveCap/.test(e.message)), JSON.stringify(result.errors));
});
