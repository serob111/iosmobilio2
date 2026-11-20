import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts', 'test/**/*.spec.tsx'],
    coverage: {
      provider: 'v8',
      // The config plugins' *pure* helpers (mobilioBundleDir/mobilioResourcePath,
      // applyMobilioIconsToInfoPlist) are unit-tested directly — see
      // test/plugins/*.spec.ts. The plugin files' own ConfigPlugin wrapper glue
      // (withDangerousMod/withXcodeProject/withInfoPlist calls) isn't included here:
      // it's Xcode-project-shaped I/O that a real `expo prebuild` run validates far
      // more meaningfully than a synthetic in-memory Xcode project fixture would (and
      // was — see the Phase 1 report), so it's not double-counted against this
      // threshold.
      include: [
        'src/config/loadConfig.ts',
        'src/config/launchDestination.ts',
        'src/components/brandSplashData.ts',
        'src/notifications/registerPush.ts',
        'src/notifications/useRegisterPushOnMount.ts',
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
