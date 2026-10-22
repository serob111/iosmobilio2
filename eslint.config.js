// @ts-check
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.expo/**',
      '**/ios/**',
      '**/android/**',
      '**/eslint.config.js',
      '**/coverage/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['packages/config/**/*.ts', 'packages/db/**/*.ts', 'packages/storage/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
