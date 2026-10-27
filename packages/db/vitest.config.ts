import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Vitest runs test files in parallel by default. builds-watchdog.integration.test.ts
    // calls public.fail_stuck_builds, which scans/updates the *entire* builds table with
    // no org scoping (a real system-wide watchdog has to work that way) — running it
    // concurrently with builds-rls.integration.test.ts against the same live Postgres
    // produced genuine cross-file interference (confirmed by hand: each file passes
    // cleanly alone, both fail when run together). Same root cause and fix as apps/api's
    // vitest.config.ts already documents for its own live-service integration specs.
    fileParallelism: false,
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
