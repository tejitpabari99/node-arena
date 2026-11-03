import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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
  for (const doc of ['README.md', 'AGENTS.md', 'tools/README.md', 'docs/README.md', 'docs/specs/game-rules.md', 'docs/implementation/content-authoring.md', 'docs/implementation/owner-art.md', 'docs/implementation/level-import.md', 'docs/reference/level-coverage.md', 'docs/reference/credits.md', 'docs/operations/pvp-server.md', 'docs/decisions/futures.md']) put(doc);
  const indexes: Record<string, string[]> = {
    concepts: [], implementation: ['content-authoring.md', 'owner-art.md', 'level-import.md'],
    reference: ['level-coverage.md', 'credits.md'], decisions: ['futures.md'], testing: [],
    specs: ['game-rules.md'], operations: ['pvp-server.md'], contracts: [],
  };
  for (const [folder, files] of Object.entries(indexes)) put(`docs/${folder}/README.md`, files.map(file => `[${file}](${file})`).join('\n'));
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
  put('docs/README.md', '[Other](other.md)');
  put('docs/other.md', obsolete.map(name => `[old](../tools/${name})`).join('\n'));
  assert.equal((await checkDocs(dir)).errors.filter(error => error.message.includes('Obsolete gate reference')).length, obsolete.length);
  put('docs/other.md', '[old](layout)');
  assert.equal((await checkDocs(dir)).errors.filter(error => error.message.includes('Obsolete gate reference')).length, 1);
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

test('relocated guide fragments retain repository-path validation', async t => {
  const { dir, put } = fixture(t);
  put('docs/implementation/owner-art.md', '`apps/web/assets/missing.png`');
  const result = await checkDocs(dir);
  assert.ok(result.errors.some(error => error.file === 'docs/implementation/owner-art.md' && error.message.includes('missing.png')));
});


test('inline links resolve encoded paths, query strings, heading formatting and duplicate GitHub anchors', async t => {
  const { dir, put } = fixture(t);
  put('docs/concepts/guide café.md', '# Repeat\n# Repeat\n# Repeat-1\n# Repeat\n## **Build** `API` & deploy!\nRésumé\n------\n## _Emphasis_ and `snake_case`\n');
  put('docs/concepts/README.md', '[guide](guide%20caf%C3%A9.md?raw=1#repeat) [again](guide%20caf%C3%A9.md#repeat-1) [collision](guide%20caf%C3%A9.md#repeat-1-1) [third](guide%20caf%C3%A9.md#repeat-2) [formatted](guide%20caf%C3%A9.md#build-api--deploy) [Unicode](<guide café.md#r%C3%A9sum%C3%A9> "heading") [emphasis](guide%20caf%C3%A9.md#emphasis-and-snake_case)');
  put('README.md', '[docs](docs/README.md)');
  put('tools/README.md', '[contract](../docs/specs/game-rules.md?raw=1)');
  assert.deepEqual((await checkDocs(dir)).errors, []);
});

test('missing link targets and heading anchors produce located drift errors', async t => {
  const { dir, put } = fixture(t);
  put('docs/concepts/README.md', '# Concepts\n[missing](gone.md)\n[anchor](../specs/game-rules.md#unknown)\n[local](#unknown)\n[invalid encoding](bad%ZZ.md)');
  const errors = (await checkDocs(dir)).errors.filter(error => error.file === 'docs/concepts/README.md');
  assert.equal(errors.length, 4);
  assert.deepEqual(errors.map(error => error.pointer), ['line 2', 'line 3', 'line 4', 'line 5']);
  assert.match(errors[0]!.message, /gone\.md/);
  assert.match(errors[1]!.message, /anchor.*unknown/i);
  assert.match(errors[3]!.message, /encoding/i);
});

test('fenced and inline code examples, external protocols, autolinks and reference-style links are not local inline links', async t => {
  const { dir, put } = fixture(t);
  put('docs/concepts/README.md', [
    '[web](https://example.invalid/missing#nope) [mail](mailto:user@example.invalid) [socket](wss://example.invalid/) [relative host](//example.invalid/missing)',
    '<https://example.invalid/> [reference][missing]',
    '`[example](missing.md)` ``[example](another.md)``',
    '````md', '[example](missing.md)', '```', '[still fenced](missing.md)', '````',
    '~~~md', '[example](missing.md)', '~~~',
  ].join('\n'));
  assert.deepEqual((await checkDocs(dir)).errors, []);
});

test('missing folder indexes fail even for empty maintained folders', async t => {
  const { dir } = fixture(t);
  rmSync(resolve(dir, 'docs/concepts/README.md'));
  const errors = (await checkDocs(dir)).errors;
  assert.ok(errors.some(error => error.file === 'docs/concepts/README.md' && /index.*missing/i.test(error.message)));
});

test('folder indexes must link every sibling file, including non-Markdown files', async t => {
  const { dir, put } = fixture(t);
  put('docs/testing/notes.txt');
  put('docs/testing/README.md', 'notes.txt is mentioned but has no link.');
  let errors = (await checkDocs(dir)).errors;
  assert.ok(errors.some(error => error.file === 'docs/testing/README.md' && /notes\.txt/.test(error.message)));
  put('docs/testing/README.md', '[Notes](notes.txt?raw=1)');
  errors = (await checkDocs(dir)).errors;
  assert.deepEqual(errors, []);
});

test('nested maintained folders need indexes and docs root must list sibling Markdown files', async t => {
  const { dir, put } = fixture(t);
  put('docs/concepts/nested/topic.md', '# Topic');
  put('docs/mission.md', '# Mission');
  const errors = (await checkDocs(dir)).errors;
  assert.ok(errors.some(error => error.file === 'docs/concepts/nested/README.md' && /index.*missing/i.test(error.message)));
  assert.ok(errors.some(error => error.file === 'docs/README.md' && /mission\.md/.test(error.message)));
  put('docs/concepts/nested/README.md', '[Topic](topic.md)');
  put('docs/README.md', '[Mission](mission.md)');
  assert.deepEqual((await checkDocs(dir)).errors, []);
});

test('every maintained implementation, reference, operations and testing page checks inline repository paths', async t => {
  const { dir, put } = fixture(t);
  for (const folder of ['implementation', 'reference', 'operations', 'testing']) {
    put(`docs/${folder}/new.md`, '`packages/missing.json`');
    const index = resolve(dir, `docs/${folder}/README.md`);
    writeFileSync(index, `${readFileSync(index, 'utf8')}\n[New](new.md)\n`);
  }
  const errors = (await checkDocs(dir)).errors;
  assert.equal(errors.length, 4);
  assert.ok(errors.every(error => error.file.endsWith('/new.md') && error.message.includes('packages/missing.json')));
});

test('required relocated docs cannot disappear unnoticed when their index is edited', async t => {
  const { dir, put } = fixture(t);
  rmSync(resolve(dir, 'docs/operations/pvp-server.md'));
  put('docs/operations/README.md');
  assert.ok((await checkDocs(dir)).errors.some(error => error.file === 'docs/operations/pvp-server.md' && /missing/i.test(error.message)));
});

test('historical docs links and indexes stay outside new gates while incoming evidence links resolve', async t => {
  const { dir, put } = fixture(t);
  for (const folder of ['agent_files', 'research', 'img']) put(`docs/${folder}/nested/evidence.md`, '# Evidence\n[historical missing link](missing.md)');
  put('docs/concepts/README.md', '[Evidence](../research/nested/evidence.md#evidence) [Branch](../agent_files/nested/evidence.md#evidence) [Images](../img/)');
  assert.deepEqual((await checkDocs(dir)).errors, []);
});

test('runtime URLs and explicit environment values do not hide missing repository paths', async t => {
  const { dir, put } = fixture(t);
  put('docs/operations/pvp-server.md', '`https://example.invalid/healthz` `CONTENT_DIR=/app/content-data/data`\n`apps/server/missing.ts`');
  const errors = (await checkDocs(dir)).errors;
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.file, 'docs/operations/pvp-server.md');
  assert.ok(errors[0]!.message.includes('apps/server/missing.ts'));
});
