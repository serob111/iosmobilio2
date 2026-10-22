import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // Vitest runs test files in parallel by default; the live-Postgres/Redis
    // integration specs (auth-flow, organizations-race) share the same Redis rate-limit
    // buckets (Better Auth's secondaryStorage, keyed by path), so two of them running
    // concurrently can reset/consume each other's budget mid-test — caught as a real,
    // reproducible failure (not flaky in isolation) once a second integration file was
    // added. Sequential files cost a few seconds; a nondeterministic rate-limit
    // assertion costs more in practice.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      // Scoped to the modules each stage's spec explicitly mandates a threshold for —
      // health/queue/db predate Этап 1 and aren't part of either stage's coverage
      // mandate, though they're reasonably covered regardless.
      include: [
        'src/auth/**/*.ts',
        'src/organizations/**/*.ts',
        'src/projects/**/*.ts',
        'src/storage/**/*.ts',
        'src/net/**/*.ts',
      ],
      exclude: ['src/**/*.spec.ts', 'src/**/*.d.ts', 'src/**/*.types.ts'],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
