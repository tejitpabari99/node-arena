import tseslint from 'typescript-eslint';
import determinism from '../sim/eslint.determinism.cjs';

/** Net core is transport-free and deterministic: no ws, node:*, DOM, bots or apps. */
export function createNetPreset(sourceRoot = 'src') {
  const sourceFiles = [`${sourceRoot}/**/*.ts`];
  return [
    { files: sourceFiles, languageOptions: { parser: tseslint.parser } },
    ...determinism.createPreset({
      sourceFiles,
      mathFiles: [`${sourceRoot}/math.ts`],
      hashFiles: [`${sourceRoot}/hash.ts`, `${sourceRoot}/hash/**/*.ts`],
    }),
    { files: sourceFiles, rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: '@node-arena/content', allowTypeImports: true, message: 'Net may import content types only.' }],
        patterns: [
          { regex: '^(?!(?:\\.{1,2}/|@node-arena/(?:defs|sim|content)$)).+', message: 'Net may import only relative modules, @node-arena/defs, public sim exports and content types (no ws, node:*, DOM, bots or apps).' },
          { group: ['**/sim/**', '**/content/**', '**/defs/**'], message: 'Use the public workspace package boundary.' },
        ],
      }],
      'no-restricted-syntax': ['error', {
        selector: 'ImportExpression',
        message: 'Use static imports in net core so dependency boundaries can be checked.',
      }],
    } },
  ];
}

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  ...createNetPreset(),
];
