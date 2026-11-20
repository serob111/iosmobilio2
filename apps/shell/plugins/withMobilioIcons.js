const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { withDangerousMod, withInfoPlist, withXcodeProject } = require('@expo/config-plugins');

// Relative to <platformProjectRoot>/<projectName> — where Expo's prebuild puts a
// single-size (1024x1024, "universal" idiom) asset-catalog app icon by default,
// wired up via the ASSETCATALOG_COMPILER_APPICON_NAME build setting below. Confirmed
// on a real macOS archive (not assumed): even with CFBundleIconName deleted from the
// static Info.plist, Xcode's actool still compiled this catalog and merged its own
// partial Info.plist fragment on top at build time, silently overwriting
// CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconFiles with a single actool-derived
// entry instead of the four files this plugin actually ships. Removing the catalog
// and clearing the build setting is what stops that merge from happening at all.
const APP_ICON_APPICONSET_PATH = ['Images.xcassets', 'AppIcon.appiconset'];

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
      const appIconSetDir = path.join(
        cfg.modRequest.platformProjectRoot,
        cfg.modRequest.projectName,
        ...APP_ICON_APPICONSET_PATH,
      );
      fs.rmSync(appIconSetDir, { recursive: true, force: true });
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
    // Without this, actool has no icon set left to compile (the appiconset directory
    // is already gone), but the build setting pointing at it would still make Xcode
    // try — and fail, or at best no-op in a way this shouldn't depend on.
    project.updateBuildProperty('ASSETCATALOG_COMPILER_APPICON_NAME', '""');
    return cfg;
  });
};

module.exports = { withMobilioIcons, applyMobilioIconsToInfoPlist, ICON_FILES, APP_ICON_APPICONSET_PATH };
