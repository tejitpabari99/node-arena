import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from '../cli.js';
import { defaultContentDir, runImport } from '../run.js';
import { twExtractRoot } from '../env.js';

const root = twExtractRoot();
const skip = root === null ? 'TW_EXTRACT not set' : false;
const cli = resolve(import.meta.dirname, '../../cli.ts');

test('parseArgs: range/only/flags; bad input throws', () => {
  assert.deepEqual(parseArgs([]), { only: [], skipBlocked: false, check: false });
  assert.deepEqual(parseArgs(['--range', '24-25', '--only', 'a,b', '--skip-blocked', '--check']), { range: [24, 25], only: ['a', 'b'], skipBlocked: true, check: true });
  assert.throws(() => parseArgs(['--range', 'x']));
  assert.throws(() => parseArgs(['--nope']));
  assert.throws(() => parseArgs(['--only']));
});

test('check:import without TW_EXTRACT skips with exit 0; import:tw exits 2', () => {
  const env = { ...process.env }; delete env['TW_EXTRACT'];
  const c = spawnSync('pnpm', ['exec', 'tsx', cli, 'check:import'], { env, encoding: 'utf8' });
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, /skipped \(TW_EXTRACT unset\)/);
  const i = spawnSync('pnpm', ['exec', 'tsx', cli, 'import:tw'], { env, encoding: 'utf8' });
  assert.equal(i.status, 2);
});

test('determinism (TW_EXTRACT): two runs identical; input order (--only and campaign/file listing) does not change level bytes', { skip }, async () => {
  const o = { extractRoot: root as string, contentDir: defaultContentDir(), range: [4, 8] as const };
  const a = await runImport(o);
  const b = await runImport(o);
  assert.deepEqual([...a.files], [...b.files]);
  const names = a.rows.map((r) => r.entry.id);
  const fwd = await runImport({ ...o, only: names });
  const rev = await runImport({ ...o, only: [...names].reverse() });
  assert.deepEqual([...fwd.files].sort(), [...rev.files].sort());
  for (const [p, bytes] of fwd.files) assert.equal(a.files.get(p), bytes);
  // shuffle the real inputs: campaign entries (reversed remote-config order) and the prefab/file listing order
  for (const permuteEntries of [(es: typeof a.rows[number]['entry'][]) => es.reverse(), (es: typeof a.rows[number]['entry'][]) => [...es.slice(2), ...es.slice(0, 2)]]) {
    const shuffled = await runImport({ ...o, permuteEntries });
    assert.deepEqual([...shuffled.files], [...a.files]);
    assert.deepEqual(shuffled.rows.map((r) => r.entry.position), a.rows.map((r) => r.entry.position));
  }
});
