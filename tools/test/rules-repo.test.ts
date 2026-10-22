import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
function run(command: string, ...args: string[]) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tools/src/cli.ts', command, ...args], { cwd: root, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, report: args.includes('json') ? JSON.parse(result.stdout) : undefined };
}

test('check:rules passes the repository with JSON and Markdown reports', () => {
  const result = run('check:rules', '--format', 'json');
  assert.equal(result.status, 0, result.stdout); assert.equal(result.report.ok, true);
  assert.match(result.report.summary, /38 active rules; 38 covered/);
  const markdown = run('check:rules'); assert.equal(markdown.status, 0, markdown.stdout); assert.match(markdown.stdout, /# check:rules: PASS/);
});
