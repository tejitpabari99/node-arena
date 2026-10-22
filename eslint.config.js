import tseslint from 'typescript-eslint';
import { createBotsPreset } from './packages/bots/eslint.config.js';
import determinism from './packages/sim/eslint.determinism.cjs';

const nodeOnly = ['fs', 'fs/*', 'node:fs', 'node:fs/*', 'path', 'path/*', 'node:path', 'node:path/*', 'crypto', 'crypto/*', 'node:crypto', 'node:crypto/*'];

export default [
  ...createBotsPreset('packages/bots/src'),
  ...determinism.createPreset({
    sourceFiles: ['packages/sim/src/**/*.ts'],
    mathFiles: ['packages/sim/src/math.ts'],
    hashFiles: ['packages/sim/src/hash.ts', 'packages/sim/src/hash/**/*.ts'],
  }),
  { files: ['packages/sim/src/**/*.ts'], rules: determinism.contentTypesOnly },
  {
    // Engine internals are for sim tests and SP04 seam work only; web/bots/tools use the public `@node-arena/sim`.
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs', '**/*.cjs'],
    ignores: ['packages/sim/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['@node-arena/sim/internal', '@node-arena/sim/internal/*'], message: '@node-arena/sim/internal is for packages/sim only; use @node-arena/sim.' }] }] },
  },
  { ignores: ['**/node_modules/**', '**/dist/**', '**/test-results/**', '**/playwright-report/**', '.worktrees/**'] },
  { files: ['**/*.ts', '**/*.tsx'], languageOptions: { parser: tseslint.parser } },
  {
    // Render determinism (SP01 N6, mirrors apps/web/visual/lib/lint-determinism.mjs): seed jitter via src/render/rng.ts.
    files: ['apps/web/src/render/**/*.{ts,tsx}', 'apps/web/src/fx/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-properties': ['error',
        ...[['Math', 'random'], ['crypto', 'getRandomValues'], ['Date', 'now'], ['performance', 'now']].map(([object, property]) => ({
          object, property, message: 'Render code must be deterministic: use seededRandom(pairKey, tick) from src/render/rng.ts (no wall clock / unseeded random).',
        })),
      ],
    },
  },
  {
    files: ['packages/content/src/**/*.ts', 'packages/defs/src/**/*.ts'],
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
