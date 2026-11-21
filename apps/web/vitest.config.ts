import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
    // This workspace pins react/react-dom to a different version than the repo
    // root's hoisted copy, so npm nests a second one under apps/web/node_modules.
    // Packages that live at the root (next-intl, use-intl) resolve 'react' from
    // there instead, giving two live React copies in the same test — hooks called
    // from the root copy then see a null dispatcher. dedupe forces every resolution
    // of these specifiers onto the single copy react-dom actually renders with.
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts', './test/componentSetup.ts'],
    exclude: ['**/node_modules/**', '**/e2e/**', '**/.next/**'],
    // Externalized deps are loaded via plain Node require(), which ignores the
    // resolve.dedupe above and lets next-intl/use-intl (hoisted at the repo root)
    // pick up the root's react instead of this workspace's pinned one. Inlining
    // them routes their 'react' import through Vite's resolver instead.
    server: {
      deps: {
        inline: [/next-intl/, /use-intl/],
      },
    },
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
