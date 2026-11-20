const path = require('node:path');
const sharp = require('sharp');
const { withDangerousMod, withInfoPlist, withXcodeProject } = require('@expo/config-plugins');

/**
 * [filename, pixel size] — CFBundleIconFiles entries, not an asset catalog. repack
 * (packages/repacker) regenerates these exact four files from each client's 1024x1024
 * source icon after the base is built; the base ships placeholders generated from
 * assets/icon.png so its own CI archive has real files to copy at these paths (Copy
 * Bundle Resources fails on a missing file, same reasoning as the demo mobilio/
 * config.json/splash.png in withMobilioBundleResources.js).
 *
 * @type {ReadonlyArray<readonly [string, number]>}
 */
const ICON_FILES = [
  ['AppIcon60x60@2x.png', 120],
  ['AppIcon60x60@3x.png', 180],
  ['AppIcon76x76@2x~ipad.png', 152],
  ['AppIcon83.5x83.5@2x~ipad.png', 167],
];

/**
 * Pure, snapshot-testable: everything applyMobilioIconsToInfoPlist does to the plist,
 * with no filesystem/Xcode-project I/O.
 *
 * @param {Record<string, unknown>} infoPlist
 * @returns {Record<string, unknown>}
 */
function applyMobilioIconsToInfoPlist(infoPlist) {
  const next = { ...infoPlist };
  delete next.CFBundleIconName;
  const iphoneFiles = ICON_FILES.filter(([name]) => !name.includes('ipad')).map(([name]) => name);
  const ipadFiles = ICON_FILES.filter(([name]) => name.includes('ipad')).map(([name]) => name);
  next.CFBundleIcons = { CFBundlePrimaryIcon: { CFBundleIconFiles: iphoneFiles } };
  // Real Info.plist key is "CFBundleIcons~ipad" (the ~ipad device-family-variant
  // suffix Apple's plist format uses) — a bracket/string-literal key, not a JS
  // identifier.
  next['CFBundleIcons~ipad'] = {
    CFBundlePrimaryIcon: { CFBundleIconFiles: [...iphoneFiles, ...ipadFiles] },
  };
  return next;
}

/**
 * Info.plist must reference these by CFBundleIcons/CFBundleIcons~ipad, not
 * CFBundleIconName — CFBundleIconName points at an asset catalog icon set, which
 * Linux (where repack runs) can't produce: Apple's Assets.car compiler (actool) is
 * macOS-only. CFBundleIconFiles is the older, asset-catalog-free mechanism and is still
 * fully supported for exactly this reason.
 *
 * @type {import('@expo/config-plugins').ConfigPlugin}
 */
const withMobilioIcons = (config) => {
  config = withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const sourceIcon = path.join(cfg.modRequest.projectRoot, 'assets', 'icon.png');
      await Promise.all(
        ICON_FILES.map(([filename, size]) =>
          sharp(sourceIcon)
            .resize(size, size)
            .png()
            .toFile(path.join(cfg.modRequest.platformProjectRoot, filename)),
        ),
      );
      return cfg;
    },
  ]);

  config = withInfoPlist(config, (cfg) => {
    cfg.modResults = applyMobilioIconsToInfoPlist(cfg.modResults);
    return cfg;
  });

  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const target = project.getFirstTarget().uuid;
    for (const [filename] of ICON_FILES) {
      project.addResourceFile(filename, { target });
    }
    return cfg;
  });
};

module.exports = { withMobilioIcons, applyMobilioIconsToInfoPlist, ICON_FILES };
