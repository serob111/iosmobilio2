import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createZip } from '../src/archive';
import { extractZip } from '../src/extract';

describe('createZip + extractZip round trip', () => {
  let sourceDir: string;
  let destDir: string;
  let zipPath: string;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), 'repacker-roundtrip-'));
    sourceDir = join(root, 'source');
    destDir = join(root, 'dest');
    zipPath = join(root, 'out.ipa');
    mkdirSync(sourceDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(join(sourceDir, '..'), { recursive: true, force: true });
  });

  it('round-trips a regular file byte-for-byte', async () => {
    writeFileSync(join(sourceDir, 'Info.plist'), '<?xml version="1.0"?><plist></plist>');
    await createZip(sourceDir, zipPath);
    await extractZip(zipPath, destDir);
    expect(readFileSync(join(destDir, 'Info.plist'), 'utf8')).toBe('<?xml version="1.0"?><plist></plist>');
  });

  it('preserves the executable bit on a Mach-O-like binary', async () => {
    const binaryPath = join(sourceDir, 'MobilioShell');
    writeFileSync(binaryPath, Buffer.from([0xcf, 0xfa, 0xed, 0xfe]));
    if (process.platform !== 'win32') {
      chmodSync(binaryPath, 0o755);
    }

    await createZip(sourceDir, zipPath);
    await extractZip(zipPath, destDir);

    const extractedPath = join(destDir, 'MobilioShell');
    expect(readFileSync(extractedPath).equals(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]))).toBe(true);
    if (process.platform !== 'win32') {
      expect(statSync(extractedPath).mode & 0o777).toBe(0o755);
    }
  });

  it('round-trips a nested directory structure', async () => {
    mkdirSync(join(sourceDir, 'Frameworks', 'React.framework'), { recursive: true });
    writeFileSync(join(sourceDir, 'Frameworks', 'React.framework', 'React'), 'fake framework binary');
    await createZip(sourceDir, zipPath);
    await extractZip(zipPath, destDir);
    expect(readFileSync(join(destDir, 'Frameworks', 'React.framework', 'React'), 'utf8')).toBe('fake framework binary');
  });

  it('round-trips an empty directory', async () => {
    mkdirSync(join(sourceDir, 'mobilio'), { recursive: true });
    await createZip(sourceDir, zipPath);
    await extractZip(zipPath, destDir);
    expect(statSync(join(destDir, 'mobilio')).isDirectory()).toBe(true);
  });

  it('excludes __MACOSX and .DS_Store even when present in the source tree', async () => {
    mkdirSync(join(sourceDir, '__MACOSX'), { recursive: true });
    writeFileSync(join(sourceDir, '__MACOSX', 'junk'), 'macos metadata junk');
    writeFileSync(join(sourceDir, '.DS_Store'), 'ds store junk');
    writeFileSync(join(sourceDir, 'real.txt'), 'real content');

    await createZip(sourceDir, zipPath);
    await extractZip(zipPath, destDir);

    expect(() => statSync(join(destDir, '__MACOSX'))).toThrow();
    expect(() => statSync(join(destDir, '.DS_Store'))).toThrow();
    expect(readFileSync(join(destDir, 'real.txt'), 'utf8')).toBe('real content');
  });

  // Creating a symlink requires elevated privileges on Windows (EPERM without Developer
  // Mode/admin) — genuinely unavailable on a plain Windows dev box, but not on the
  // Linux CI runner (ci.yml) this is scoped to actually run for real on, or on the
  // Linux worker this package ships to in production.
  it.skipIf(process.platform === 'win32')('round-trips a symlink, not its target\'s content', async () => {
    mkdirSync(join(sourceDir, 'Versions'), { recursive: true });
    writeFileSync(join(sourceDir, 'Versions', 'target.bin'), 'target content');
    symlinkSync('target.bin', join(sourceDir, 'Versions', 'Current'));

    await createZip(sourceDir, zipPath);
    await extractZip(zipPath, destDir);

    expect(lstatSync(join(destDir, 'Versions', 'Current')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(destDir, 'Versions', 'Current'))).toBe('target.bin');
  });
});
