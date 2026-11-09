import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    exclude: ['**/node_modules/**', '**/e2e/**', '**/.next/**'],
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts'],
      // authClient.ts/fonts.ts are pure SDK/config initialization (Better Auth client
      // factory, next/font/google setup) with no logic of their own to exercise.
      exclude: ['lib/**/*.d.ts', 'lib/authClient.ts', 'lib/fonts.ts'],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
