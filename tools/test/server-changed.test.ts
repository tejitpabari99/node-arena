import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve(import.meta.dirname, '../../scripts/server-changed.mjs');
const mod = (await import(script)) as {
  isServerPath(p: string): boolean;
  serverChanged(before: string | undefined, after: string, cwd: string): boolean;
};

test('isServerPath: server-affecting paths only', () => {
  for (const p of ['apps/server/src/main.ts', 'packages/net/src/x.ts', 'packages/sim/a.ts', 'packages/content/data/b.json', 'packages/bots/c.ts', 'packages/defs/d.ts', 'pnpm-lock.yaml', '.github/workflows/deploy-server.yml']) {
    assert.equal(mod.isServerPath(p), true, p);
  }
  for (const p of ['apps/web/src/a.ts', 'docs/x.md', '.github/workflows/deploy.yml', 'packages/netx/a.ts', 'tools/src/a.ts', 'README.md']) {
    assert.equal(mod.isServerPath(p), false, p);
  }
});

test('serverChanged: real git repo, web-only vs sim push, missing before', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'srvchg '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' }).trim();
  const commit = (file: string) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), String(Math.random()));
    git('add', '-A');
    git('commit', '-qm', file);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q');
  const c0 = commit('README.md');
  const c1 = commit('apps/web/src/a.ts');
  const c2 = commit('packages/sim/src/b.ts');
  assert.equal(mod.serverChanged(c0, c1, dir), false);
  assert.equal(mod.serverChanged(c1, c2, dir), true);
  assert.equal(mod.serverChanged(c0, c2, dir), true);
  assert.equal(mod.serverChanged('0000000000000000000000000000000000000000', c2, dir), true);
  assert.equal(mod.serverChanged('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', c2, dir), true);
  assert.equal(mod.serverChanged(undefined, c2, dir), true);
  assert.equal(execFileSync(process.execPath, [script, c0, c1], { cwd: dir, encoding: 'utf8' }).trim(), 'false');
});
