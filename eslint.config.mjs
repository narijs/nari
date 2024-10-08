import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import eslintJsPlugin from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default [
  {
    ignores: ['lib/*'],
    rules: eslintJsPlugin.configs.recommended.rules,
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      globals: { ...globals.node, structuredClone: true },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/__test__/*.ts'],
    languageOptions: {
      globals: globals.jest,
    },
  },
  eslintPluginPrettierRecommended,
];
