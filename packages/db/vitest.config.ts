import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // schema/** is declarative table definitions (no branches to exercise beyond
      // "the module loads"); migrate.ts is a CLI entrypoint covered by actually running
      // it against a real Postgres in CI, not by unit tests.
      exclude: ['src/**/*.d.ts', 'src/schema/**', 'src/migrate.ts', 'src/index.ts'],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
