const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { ESLint } = require('eslint');
const root = path.resolve(__dirname, '../../..');

for (const cwd of [root, path.resolve(__dirname, '..')]) {
  const name = cwd === root ? 'root' : 'package';
  const filePath = cwd === root ? 'packages/bots/src/probe.ts' : 'src/probe.ts';
  const lint = async source => {
    const [result] = await new ESLint({ cwd }).lintText(source, { filePath });
    return result;
  };
  for (const source of [
    'Math.random();', 'Math.sqrt(4);', 'new Date();', 'const n = 1.5;',
    'import fs from "node:fs";',
    'import { loadContent } from "@node-arena/content";',
    'import { create } from "@node-arena/sim/src/state.js";',
    'import { create } from "../../sim/src/state.js";',
    'export { create } from "../../sim/src/state.js";',
    'import("node:fs");',
  ]) {
    test(`${name} lint rejects ${source}`, async () => {
      assert.ok((await lint(source)).errorCount > 0, source);
    });
  }
  test(`${name} lint allows public sim imports and content types`, async () => {
    const result = await lint('import { idiv, type SimView } from "@node-arena/sim"; import type { CompiledLevel } from "@node-arena/content"; const n = idiv(1000, 2);');
    assert.deepEqual(result.messages, []);
  });
}

test('covers R1: bots src has no CutLine, Math.random or Date', () => {
  const dir = path.resolve(__dirname, '../src');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.ts'))) {
    const code = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /CutLine/, `${f}: CutLine`);
    assert.doesNotMatch(code, /Math\.random/, `${f}: Math.random`);
    assert.doesNotMatch(code, /\bDate\b/, `${f}: Date`);
  }
});
