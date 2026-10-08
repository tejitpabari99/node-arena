const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { ESLint } = require('eslint');
const parser = require('typescript-eslint').parser;
const simDir = path.resolve(__dirname, '..');

// Removing the preset or weakening a restriction must fail these real ESLint checks.
test('sim exposes a reusable determinism preset', () => {
  assert.ok(fs.existsSync(path.join(simDir, 'eslint.determinism.cjs')), 'Missing determinism preset');
});
async function lint(source, file = 'src/index.ts', cwd = simDir) {
  const preset = require('../eslint.determinism.cjs');
  const eslint = new ESLint({ cwd, overrideConfigFile: true, overrideConfig: [
    { files: ['**/*.ts'], languageOptions: { parser } }, ...preset,
    { files: ['src/**/*.ts'], rules: preset.contentTypesOnly },
  ] });
  const [result] = await eslint.lintText(source, { filePath: file });
  return result.messages;
}
for (const source of [
  ...['random', 'sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'pow', 'exp', 'log', 'hypot', 'round', 'floor', 'trunc', 'imul'].map(name => `Math.${name}(1);`),
  'Math["random"]();', 'const { random } = Math;',
  'new Date();', 'Date.now();', 'performance.now();', 'setTimeout(() => {}, 1);',
  'setInterval(() => {}, 1);', 'clearTimeout(1);', 'queueMicrotask(() => {});',
  'console.log(1);', 'new Intl.Collator();', 'globalThis.Math.random();',
  'globalThis.Date.now();', 'const n = 1.5;', 'const n = 1e-3;',
  'for (const key in {}) {}', '[2, 1].sort();', '[2, 1]["sort"]();',
  'import { compileLevel } from "@node-arena/content";',
  'import type { Stats } from "node:fs";',
]) {
  test(`rejects ${source}`, async () => assert.ok((await lint(source)).length > 0));
}
test('only src/math.ts can use integer Math helpers', async () => {
  assert.deepEqual(await lint('Math.floor(1); Math.trunc(1); Math.imul(1, 2);', 'src/math.ts'), []);
  assert.ok((await lint('Math.random();', 'src/math.ts')).length > 0);
  assert.ok((await lint('Math.floor(1);', 'src/systems/math.ts')).length > 0);
});
test('hash paths cannot stringify JSON', async () => {
  assert.ok((await lint('JSON.stringify({});', 'src/hash.ts')).length > 0);
  assert.ok((await lint('JSON["stringify"]({});', 'src/hash/state.ts')).length > 0);
  assert.deepEqual(await lint('JSON.stringify({});', 'src/replay.ts'), []);
});
test('integer math, explicit sort, strings and content type imports remain valid', async () => {
  assert.deepEqual(await lint('import type { CompiledLevel } from "@node-arena/content"; export type Level = CompiledLevel; const n = 1000; const name = "1.5"; [2, 1].sort((a, b) => a - b);'), []);
});
test('bots can import the preset with their own src/math.ts exception', async () => {
  const botsDir = path.resolve(simDir, '../bots');
  assert.ok((await lint('Math.random();', 'src/strategy.ts', botsDir)).length > 0);
  assert.deepEqual(await lint('Math.imul(1, 2);', 'src/math.ts', botsDir), []);
});
