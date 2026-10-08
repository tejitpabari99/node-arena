import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: new URL('../../../', import.meta.url).pathname });
for (const filename of ['loader.ts', 'validate.ts', 'compiler.ts', 'hash.ts', 'loadContent.ts', 'validateContent.ts', 'compileLevel.ts', 'hash/sha256.ts']) {
  for (const specifier of ['fs', 'fs/promises', 'node:fs', 'node:fs/promises', 'path', 'node:path', 'crypto', 'node:crypto']) {
    test(`${filename} rejects the Node import ${specifier}`, async () => {
      const results = await eslint.lintText(`import forbidden from '${specifier}';`, {
        filePath: `packages/content/src/${filename}`,
      });
      assert.equal(results[0]?.errorCount, 1);
      assert.equal(results[0]?.messages[0]?.ruleId, 'no-restricted-imports');
    });
  }
}

test('a browser-safe validator may import Ajv', async () => {
  const [result] = await eslint.lintText("import { Ajv } from 'ajv';", { filePath: 'packages/content/src/validate.ts' });
  assert.equal(result?.errorCount, 0);
});

for (const source of [
  "export { readFile } from 'node:fs';",
  "const fs = await import('node:fs');",
  "const crypto = require('node:crypto');",
]) {
  test(`the browser boundary also rejects ${source}`, async () => {
    const [result] = await eslint.lintText(source, { filePath: 'packages/content/src/loader.ts' });
    assert.equal(result?.errorCount, 1);
  });
}
