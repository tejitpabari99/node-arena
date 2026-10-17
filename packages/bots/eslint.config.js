import tseslint from 'typescript-eslint';
import determinism from '../sim/eslint.determinism.cjs';

/** Apply the same policy from either the workspace or this package directory. */
export function createBotsPreset(sourceRoot = 'src') {
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
        paths: [{ name: '@node-arena/content', allowTypeImports: true, message: 'Bots may import content types only.' }],
        patterns: [
          { regex: '^(?!(?:\\.{1,2}/|@node-arena/(?:sim|content)$)).+', message: 'Bots may import only public sim exports and content types.' },
          { group: ['**/sim/**', '**/content/**'], message: 'Use the public workspace package boundary.' },
        ],
      }],
      'no-restricted-syntax': ['error', {
        selector: 'ImportExpression',
        message: 'Use static imports in bot core so dependency boundaries can be checked.',
      }],
    } },
  ];
}

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  ...createBotsPreset(),
];
