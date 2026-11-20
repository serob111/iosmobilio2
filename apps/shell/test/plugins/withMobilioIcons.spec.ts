import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires -- plain-JS plugin, see withMobilioIcons.js's own top comment for why
const { applyMobilioIconsToInfoPlist, ICON_FILES } = require('../../plugins/withMobilioIcons.js');

describe('applyMobilioIconsToInfoPlist', () => {
  it('removes CFBundleIconName and sets CFBundleIcons/CFBundleIcons~ipad from CFBundleIconFiles — snapshot', () => {
    const input = {
      CFBundleIconName: 'AppIcon',
      CFBundleDisplayName: 'Mobilio',
      CFBundleIdentifier: 'am.mobilio.shell.base',
    };
    expect(applyMobilioIconsToInfoPlist(input)).toMatchSnapshot();
  });

  it('never leaves CFBundleIconName present, even if the input never had one', () => {
    const result = applyMobilioIconsToInfoPlist({ CFBundleDisplayName: 'Mobilio' });
    expect(result.CFBundleIconName).toBeUndefined();
  });

  it("CFBundleIcons~ipad's file list is a superset of CFBundleIcons' (iPhone files plus the iPad-only ones)", () => {
    const result = applyMobilioIconsToInfoPlist({});
    const iphoneFiles = result.CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconFiles;
    const ipadFiles = result['CFBundleIcons~ipad'].CFBundlePrimaryIcon.CFBundleIconFiles;
    for (const file of iphoneFiles) {
      expect(ipadFiles).toContain(file);
    }
    expect(ipadFiles.length).toBeGreaterThan(iphoneFiles.length);
  });

  it('does not mutate the input object', () => {
    const input = { CFBundleIconName: 'AppIcon' };
    applyMobilioIconsToInfoPlist(input);
    expect(input.CFBundleIconName).toBe('AppIcon');
  });

  it('lists exactly the four CFBundleIconFiles entries the base build generates with sharp', () => {
    expect(ICON_FILES.map(([name]: [string, number]) => name)).toEqual([
      'AppIcon60x60@2x.png',
      'AppIcon60x60@3x.png',
      'AppIcon76x76@2x~ipad.png',
      'AppIcon83.5x83.5@2x~ipad.png',
    ]);
  });
});
