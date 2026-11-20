import path from 'node:path';
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires -- plain-JS plugin, see withMobilioBundleResources.js's own top comment for why
const { mobilioBundleDir, mobilioResourcePath, MOBILIO_DIR_NAME } = require('../../plugins/withMobilioBundleResources.js');

describe('withMobilioBundleResources path helpers', () => {
  it('"mobilio"', () => {
    expect(MOBILIO_DIR_NAME).toBe('mobilio');
  });

  it('nests the on-disk directory under <projectName>, not directly under platformProjectRoot', () => {
    // Confirmed against a real `expo prebuild` run (not just asserted): platformProjectRoot
    // is the top-level `ios/` dir, a sibling of `ios/<projectName>/` — a bare
    // `platformProjectRoot/mobilio` collided with `ios/Mobilio` on every filesystem this
    // actually builds on (APFS/macOS and NTFS/Windows are both case-insensitive by
    // default), since this app's own folder is "Mobilio".
    const result = mobilioBundleDir(path.join('/repo/apps/shell/ios'), 'Mobilio');
    expect(result).toBe(path.join('/repo/apps/shell/ios', 'Mobilio', 'mobilio'));
  });

  it('the Xcode-project-relative resource path matches the on-disk nesting exactly', () => {
    const onDisk = mobilioBundleDir(path.join('/repo/apps/shell/ios'), 'Mobilio');
    const resourcePath = mobilioResourcePath('Mobilio');
    expect(onDisk.endsWith(resourcePath.split('/').join(path.sep))).toBe(true);
    expect(resourcePath).toBe('Mobilio/mobilio');
  });
});
