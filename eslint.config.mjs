import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default defineConfig([
  { ignores: ['node_modules/**', 'dist/**', 'data/**', 'demo/**', 'chrome-profile/**', 'logs/**', 'scratch/**', 'state/**', '.husky/_/**'] },
  {
    files: ['**/*.{js,mjs,ts,tsx,mts}'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
    rules: { 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
  {
    files: ['**/*.{ts,tsx,mts}'],
    extends: [tseslint.configs.recommended],
  },
  {
    files: ['frontend/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  { files: ['src/hub.mjs', 'src/driver.mjs'], languageOptions: { globals: { chrome: 'readonly' } } },
]);
