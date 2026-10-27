import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'apps-script/dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Build DOM nodes or sanitize with DOMPurify instead.' },
      ],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
