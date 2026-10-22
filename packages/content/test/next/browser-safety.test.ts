import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: new URL('../../../../', import.meta.url).pathname });
const srcDir = new URL('../../src/next/', import.meta.url);
const restricted = new Set(['no-restricted-imports', 'no-restricted-modules', 'no-restricted-syntax']);

test('every next/ source file passes the browser-boundary lint rules', async () => {
  const names = (await readdir(srcDir)).filter((n) => n.endsWith('.ts'));
  for (const required of ['catalog.ts', 'level.ts', 'compile.ts', 'content.ts', 'issues.ts', 'bounds.ts']) assert.ok(names.includes(required), required);
  for (const name of names) {
    const [result] = await eslint.lintText(await readFile(new URL(name, srcDir), 'utf8'), { filePath: `packages/content/src/next/${name}` });
    const hits = result!.messages.filter((m) => restricted.has(m.ruleId ?? ''));
    assert.deepEqual(hits, [], name);
  }
});

test('no Node built-in is imported or required anywhere in next/', async () => {
  for (const name of (await readdir(srcDir)).filter((n) => n.endsWith('.ts'))) {
    const text = await readFile(new URL(name, srcDir), 'utf8');
    assert.doesNotMatch(text, /from\s+['"](node:|fs|path|crypto|os|url|child_process)/, name);
    assert.doesNotMatch(text, /require\(|process\.|Buffer\b|import\.meta\.glob|readFileSync/, name);
  }
});

for (const filename of ['next/catalog.ts', 'next/level.ts', 'next/compile.ts', 'next/content.ts']) {
  for (const specifier of ['node:fs', 'node:path', 'node:crypto', 'fs/promises']) {
    test(`${filename} rejects the Node import ${specifier}`, async () => {
      const [result] = await eslint.lintText(`import forbidden from '${specifier}';`, { filePath: `packages/content/src/${filename}` });
      assert.equal(result?.errorCount, 1);
      assert.equal(result?.messages[0]?.ruleId, 'no-restricted-imports');
    });
  }
}
