import tseslint from 'typescript-eslint';

/** Game server: Node + ws allowed; must never import the web client. */
export function createServerPreset(root = '.') {
  const files = [`${root}/src/**/*.ts`, `${root}/test/**/*.ts`, `${root}/scripts/**/*.ts`];
  return [
    { files, languageOptions: { parser: tseslint.parser } },
    { files, rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ group: ['**/apps/web', '**/apps/web/**', '**/web/src/**', '@node-arena/web', '@node-arena/web/*'], message: 'Server must not import apps/web.' }],
      }],
    } },
  ];
}

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  ...createServerPreset(),
];
