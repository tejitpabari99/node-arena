import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const cli = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'tools/src/cli.ts', 'balance', '--levels', 'levelview-1', ...args], { cwd: root, encoding: 'utf8', timeout: 120000 });

test('campaign balance rows per proxy action delay + idle; byte identical for jobs 1 and 2 in both formats', () => {
  for (const format of ['json', 'md']) {
    const args = ['--proxy', '2000,1000,idle', '--seeds', '2', '--format', format];
    const one = cli(...args, '--jobs', '1'), two = cli(...args, '--jobs', '2');
    assert.equal(one.status, 0, one.stdout + one.stderr); assert.equal(two.status, 0, two.stdout + two.stderr);
    assert.equal(one.stdout, two.stdout);
    if (format === 'json') {
      const b = JSON.parse(one.stdout).balance;
      assert.deepEqual(b.profiles, ['idle', 'proxy-1000', 'proxy-2000']);
      assert.ok(b.header.BOT_VERSION); assert.match(b.header.rulesVersion, /^\d+\.\d+\.\d+$/);
      const idle = b.rows.find((r: { profile: string }) => r.profile === 'idle');
      assert.equal(idle.winPct, 0); assert.equal(idle.observations, 2); assert.equal(idle.medianSecondsToWin, null);
      assert.equal(b.rows.find((r: { profile: string }) => r.profile === 'proxy-2000').winPct, 100);
    } else assert.match(one.stdout, /Report only/);
  }
});
test('default proxy set is AD 1000/2000/4000 + idle; arena mode drives every seat with tw', () => {
  const campaign = JSON.parse(cli('--seeds', '1', '--jobs', '1', '--format', 'json').stdout).balance;
  assert.deepEqual(campaign.profiles, ['idle', 'proxy-1000', 'proxy-2000', 'proxy-4000']);
  const arena = cli('--proxy', '2000,4000', '--seeds', '1', '--jobs', '1', '--mode', 'arena', '--format', 'json');
  assert.equal(arena.status, 0, arena.stdout + arena.stderr);
  const rows = JSON.parse(arena.stdout).balance.rows;
  assert.deepEqual(rows.map((r: { profile: string; observations: number }) => [r.profile, r.observations]), [['proxy-2000', 2], ['proxy-4000', 2]]);
});
test('balance rejects malformed options', () => {
  for (const args of [['--jobs', '0'], ['--seeds', '1.5'], ['--mode', 'bad'], ['--proxy', 'reference'], ['--targets', 'x.json']]) {
    assert.equal(cli(...args, '--format', 'json').status, 1, args.join(' '));
  }
});
