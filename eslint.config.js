import tseslint from 'typescript-eslint';
import determinism from './packages/sim/eslint.determinism.cjs';

const nodeOnly = ['fs', 'fs/*', 'node:fs', 'node:fs/*', 'path', 'path/*', 'node:path', 'node:path/*', 'crypto', 'crypto/*', 'node:crypto', 'node:crypto/*'];

export default [
  ...determinism.createPreset({
    sourceFiles: ['packages/sim/src/**/*.ts'],
    mathFiles: ['packages/sim/src/math.ts'],
    hashFiles: ['packages/sim/src/hash.ts', 'packages/sim/src/hash/**/*.ts'],
  }),
  { files: ['packages/sim/src/**/*.ts'], rules: determinism.contentTypesOnly },
  { ignores: ['**/node_modules/**', '**/dist/**', '.worktrees/**'] },
  { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
  {
    files: ['packages/content/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: nodeOnly, message: 'Content APIs must run in the browser; perform Node I/O in an external adapter.' }] }],
      'no-restricted-modules': ['error', { patterns: nodeOnly }],
      'no-restricted-syntax': ['error', {
        selector: 'ImportExpression[source.value=/^(node:)?(fs|path|crypto)(\\u002F|$)/]',
        message: 'Content APIs must run in the browser; dynamic Node imports are forbidden.',
      }],
    },
  },
];
