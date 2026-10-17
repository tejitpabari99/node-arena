import tseslint from 'typescript-eslint';
import determinism from './eslint.determinism.cjs';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  { files: ['src/**/*.ts'], languageOptions: { parser: tseslint.parser } },
  ...determinism,
  { files: ['src/**/*.ts'], rules: determinism.contentTypesOnly },
];
