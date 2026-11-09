import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      // Scoped to the library's own source — dist/ is compiled output (never meant to
      // be "covered" by anything, and v8's own instrumentation of it was dragging the
      // numbers down independently of any real source coverage gap), and
      // scripts/ensure-bucket.ts is a one-shot CLI bootstrap already exercised for real
      // by docker-compose's createbucket service, not something this package's own
      // unit tests are meant to cover.
      include: ['src/**/*.ts'],
      // src/index.ts is a pure barrel re-export (no logic of its own) — same reasoning
      // as excluding scripts/ above.
      exclude: ['**/*.spec.ts', '**/*.test.ts', '**/*.d.ts', 'src/scripts/**', 'src/index.ts'],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
