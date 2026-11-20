// Plain CommonJS, not TypeScript: app.config.ts's own transpilation only covers that
// one entry file — anything it `import`s via a relative path has to already be
// loadable by plain Node `require()`, which a local .ts file isn't without extra
// tooling. This is the standard way Expo local config plugins are written for exactly
// that reason.
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod, withXcodeProject } = require('@expo/config-plugins');

const MOBILIO_DIR_NAME = 'mobilio';

/**
 * Xcode's PRODUCT_NAME (default: the project/target name, "Mobilio") drives both the
 * .app wrapper's own filename *and* CFBundleExecutable — the compiled binary Xcode
 * writes is named after it, landing at Mobilio.app/Mobilio. On any case-insensitive
 * filesystem (every one this actually builds on), that path and Mobilio.app/mobilio —
 * where this plugin's own Copy Bundle Resources phase puts the mobilio/ folder — are
 * the *same* directory entry. Confirmed as a real, build-breaking collision on a real
 * macOS CI run (not assumed): the resource copy ran first, so the linker's later
 * attempt to write the executable there failed with "open() failed, errno=21 (Is a
 * directory)". Overriding PRODUCT_NAME alone — not app.config.ts's `name`, which still
 * drives the user-visible CFBundleDisplayName/CFBundleName — sidesteps the collision
 * without touching the "mobilio/config.json" path contract loadConfig.ts depends on.
 */
const PRODUCT_NAME_OVERRIDE = 'MobilioShell';

/**
 * Where the dangerous mod actually writes mobilio/config.json + splash.png on disk —
 * nested under the app's own source folder (`<projectName>/`), not directly under
 * platformProjectRoot. Pulled out as its own function because getting this wrong is
 * exactly the bug this comment is here to prevent: platformProjectRoot is the
 * top-level `ios/` dir, a sibling of `ios/<projectName>/` — NOT that folder itself.
 * This app's own folder is "Mobilio" (from config.name), so a bare `ios/mobilio`
 * would collide with `ios/Mobilio` into the *same* directory on every filesystem this
 * actually builds on (APFS/macOS and NTFS/Windows are both case-insensitive by
 * default) — confirmed by actually running prebuild in a case-insensitive-mounted
 * Linux container, not assumed. Nesting under projectName avoids the collision
 * entirely, since "Mobilio/mobilio" are at different path levels, not siblings.
 *
 * @param {string} platformProjectRoot
 * @param {string} projectName
 * @returns {string}
 */
function mobilioBundleDir(platformProjectRoot, projectName) {
  return path.join(platformProjectRoot, projectName, MOBILIO_DIR_NAME);
}

/**
 * The matching Xcode-project-relative path for the same directory — added to the
 * virtual "Resources" group (no explicit `group` arg to addResourceFile), which has no
 * `path` of its own, so Xcode resolves a group-relative path like this against
 * SOURCE_ROOT (platformProjectRoot) — has to be `<projectName>/mobilio`, matching
 * mobilioBundleDir above, not a bare "mobilio" relative to SOURCE_ROOT.
 *
 * @param {string} projectName
 * @returns {string}
 */
function mobilioResourcePath(projectName) {
  return `${projectName}/${MOBILIO_DIR_NAME}`;
}

/**
 * Adds `mobilio/` to the .app as a folder reference (the blue-folder kind in Xcode,
 * not a yellow group) in Copy Bundle Resources — the whole directory is copied as-is at
 * build time, so repack (packages/repacker) can later replace config.json/splash.png
 * inside the *built* .app without touching the Xcode project at all. A regular group
 * reference would instead flatten/enumerate the directory's files individually at
 * prebuild time, which repack can't retroactively undo.
 *
 * The base's own CI build (apps/shell's build-shell-base.yml) needs real files at this
 * path before xcodebuild runs or archiving fails — ships the demo config/splash here so
 * the *base* on its own is a complete, runnable (if unbranded) app; every client's
 * repack replaces both before anyone sees them.
 *
 * @type {import('@expo/config-plugins').ConfigPlugin}
 */
const withMobilioBundleResources = (config) => {
  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      const mobilioDir = mobilioBundleDir(cfg.modRequest.platformProjectRoot, cfg.modRequest.projectName);
      fs.mkdirSync(mobilioDir, { recursive: true });
      const demoBundleDir = path.join(cfg.modRequest.projectRoot, 'src', 'config', 'demo-bundle');
      fs.copyFileSync(path.join(demoBundleDir, 'config.json'), path.join(mobilioDir, 'config.json'));
      fs.copyFileSync(path.join(demoBundleDir, 'splash.png'), path.join(mobilioDir, 'splash.png'));
      return cfg;
    },
  ]);

  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const target = project.getFirstTarget().uuid;
    // lastKnownFileType: 'folder' is what makes the `xcode` package emit a folder
    // reference (sourceTree "<group>", type folder) instead of treating this as a
    // single file with an undetectable extension-based type.
    project.addResourceFile(mobilioResourcePath(cfg.modRequest.projectName), { target, lastKnownFileType: 'folder' });
    // See PRODUCT_NAME_OVERRIDE's own comment above — this is the fix for the real
    // Mobilio.app/Mobilio vs Mobilio.app/mobilio collision.
    project.updateProductName(PRODUCT_NAME_OVERRIDE);
    return cfg;
  });
};

module.exports = {
  withMobilioBundleResources,
  mobilioBundleDir,
  mobilioResourcePath,
  MOBILIO_DIR_NAME,
  PRODUCT_NAME_OVERRIDE,
};
