import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkDocs } from '../src/docs-check.js';

const root = resolve(import.meta.dirname, '../..');
function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(resolve(tmpdir(), 'docs-check-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const put = (file: string, text = '') => {
    mkdirSync(dirname(resolve(dir, file)), { recursive: true });
    writeFileSync(resolve(dir, file), text);
  };
  put('package.json', JSON.stringify({ scripts: { build: 'true', 'check:docs': 'true' } }));
  for (const doc of ['README.md', 'AGENTS.md', 'tools/README.md', 'docs/CONTENT_GUIDE.md', 'docs/LEVELS_GUIDE.md', 'docs/CREDITS.md']) put(doc);
  put('AGENTS.md', '`pnpm build`, `pnpm run check:docs`');
  return { dir, put };
}

test('valid docs resolve root, doc-relative, brace and glob paths without treating shell/env/code as paths', async t => {
  const { dir, put } = fixture(t);
  put('tools/src/current.ts');
  put('apps/web/assets/models/a.json');
  put('apps/web/assets/textures/a.json');
  put('tools/README.md', '`src/current.ts` `../AGENTS.md` `pnpm build --dir path/to/example` `TW_EXTRACT=/path/to/_extract` `{ x: 1 / 2 }` `packages/defs/src/<id>.ts`');
  put('README.md', '`tools/src/*.ts` `apps/web/assets/{models,textures}/`');
  assert.deepEqual((await checkDocs(dir)).errors, []);
});

test('script coverage requires a complete command mention, not substring or prose', async t => {
  const { dir, put } = fixture(t);
  put('AGENTS.md', '`pnpm build:extra` prose check:docs');
  const result = await checkDocs(dir);
  assert.equal(result.errors.filter(e => e.message.includes('Root script')).length, 2);
  put('tools/README.md', '| `build` | compile |\n```sh\npnpm run check:docs --format json\n```');
  assert.deepEqual((await checkDocs(dir)).errors, []);
});

test('missing concrete path, empty glob and missing brace alternative fail with located diagnostics', async t => {
  const { dir, put } = fixture(t);
  put('tools/src/current.ts');
  put('README.md', '`tools/src/gone.ts`\n`tools/src/*.json`\n`tools/src/{current,gone}.ts`');
  const result = await checkDocs(dir);
  assert.equal(result.errors.length, 3);
  assert.ok(result.errors.every(e => e.file === 'README.md' && e.pointer.startsWith('line ')));
});

test('obsolete command and link references fail across maintained Markdown; detector source fixtures and history are excluded', async t => {
  const { dir, put } = fixture(t);
  const obsolete = ['bots:churn', 'layout', 'balance-targets.json', 'slice:verify', 'visual:check'];
  put('docs/other.md', obsolete.map(name => `[old](../tools/${name})`).join('\n'));
  assert.equal((await checkDocs(dir)).errors.length, obsolete.length);
  put('docs/other.md', '[old](layout)');
  assert.equal((await checkDocs(dir)).errors.length, 1);
  put('docs/other.md', 'The layout is readable.');
  put('tools/test/detector.test.ts', JSON.stringify(obsolete));
  put('docs/agent_files/old/README.md', obsolete.join(' '));
  put('docs/research/tower-wars/06a-history.md', obsolete.join(' '));
  assert.deepEqual((await checkDocs(dir)).errors, []);
});

test('CLI reports JSON and Markdown with success/failure exit status and rejects unknown options', t => {
  const { dir, put } = fixture(t);
  const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'tools/src/cli.ts', 'check:docs', '--dir', dir, ...args], { cwd: root, encoding: 'utf8' });
  const good = run('--format', 'json');
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.equal(JSON.parse(good.stdout).ok, true);
  put('README.md', '`tools/missing.md`');
  const bad = run('--format', 'json');
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).errors[0].file, 'README.md');
  assert.match(run().stdout, /check:docs: FAIL/);
  assert.equal(run('--bogus', 'x').status, 1);
});
