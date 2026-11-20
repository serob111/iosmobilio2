#!/usr/bin/env node
// Validates the structural invariants packages/repacker (a later phase) will depend on
// being true of every base .app this workflow produces — Linux can't compile
// Assets.car, so the icon mechanism has to be the older CFBundleIconFiles one, and the
// repack step edits mobilio/config.json/splash.png in place rather than creating them,
// so they have to already exist. Run as its own step (not inlined in the archive/
// package step) so a failure here shows up as its own clearly-named, independently
// re-runnable check, and so its JSON output can be embedded in manifest.json's
// "checks" field unchanged.
import { execFileSync } from 'node:child_process';
import { accessSync, constants, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const appPath = process.argv[2];
if (!appPath) {
  console.error('Usage: verify-shell-base.mjs <path-to-.app> [path-to-write-checks-json]');
  process.exit(1);
}
const outputPath = process.argv[3];

// Mirrors apps/shell/plugins/withMobilioIcons.js's ICON_FILES exactly — a drift between
// the two would mean this check validates the wrong files without ever catching that
// the plugin's own list changed.
const EXPECTED_ICON_SIZES = {
  'AppIcon60x60@2x.png': 120,
  'AppIcon60x60@3x.png': 180,
  'AppIcon76x76@2x~ipad.png': 152,
  'AppIcon83.5x83.5@2x~ipad.png': 167,
};

const checks = [];
function check(name, passed, detail) {
  checks.push({ name, passed, detail });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}: ${detail}`);
}

function readInfoPlistAsJson() {
  const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', join(appPath, 'Info.plist')], {
    encoding: 'utf8',
  });
  return JSON.parse(json);
}

function pixelDimension(filePath, key) {
  const output = execFileSync('sips', ['-g', key, filePath], { encoding: 'utf8' });
  const match = output.match(new RegExp(`${key}:\\s*(\\d+)`));
  return match ? Number(match[1]) : null;
}

const info = readInfoPlistAsJson();

const iconFiles = info.CFBundleIcons?.CFBundlePrimaryIcon?.CFBundleIconFiles ?? [];
check(
  'info-plist-icon-keys',
  !('CFBundleIconName' in info) && iconFiles.length === Object.keys(EXPECTED_ICON_SIZES).length,
  `CFBundleIconName present=${'CFBundleIconName' in info}, CFBundleIconFiles=[${iconFiles.join(', ')}]`,
);

for (const [filename, expectedSize] of Object.entries(EXPECTED_ICON_SIZES)) {
  const filePath = join(appPath, filename);
  try {
    accessSync(filePath, constants.F_OK);
    const width = pixelDimension(filePath, 'pixelWidth');
    const height = pixelDimension(filePath, 'pixelHeight');
    check(
      `icon-size-${filename}`,
      width === expectedSize && height === expectedSize,
      `expected ${expectedSize}x${expectedSize}, got ${width}x${height}`,
    );
  } catch {
    check(`icon-size-${filename}`, false, `file not found at ${filePath}`);
  }
}

const mobilioConfigPath = join(appPath, 'mobilio', 'config.json');
const mobilioSplashPath = join(appPath, 'mobilio', 'splash.png');
try {
  accessSync(mobilioConfigPath, constants.F_OK);
  accessSync(mobilioSplashPath, constants.F_OK);
  check('mobilio-bundle-resources', true, 'mobilio/config.json and mobilio/splash.png both present');
} catch {
  check('mobilio-bundle-resources', false, `missing mobilio/config.json or mobilio/splash.png under ${appPath}`);
}

const executableName = info.CFBundleExecutable;
const executablePath = executableName ? join(appPath, executableName) : null;
try {
  if (!executablePath) throw new Error('no CFBundleExecutable in Info.plist');
  accessSync(executablePath, constants.X_OK);
  check('binary-executable', true, `${executableName} is executable`);
} catch {
  check('binary-executable', false, `${executableName ?? '(unknown)'} is missing or not executable`);
}

if (outputPath) {
  writeFileSync(outputPath, JSON.stringify(checks, null, 2));
}

const allPassed = checks.every((c) => c.passed);
if (!allPassed) {
  console.error('One or more .app structure checks failed — see output above');
  process.exit(1);
}
