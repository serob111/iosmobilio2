import { createWriteStream } from 'node:fs';
import { lstat, readdir, readlink } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { ZipFile } from 'yazl';

const EXCLUDED_NAMES = new Set(['__MACOSX', '.DS_Store']);
const UNIX_SYMLINK_MODE = 0o120000; // S_IFLNK — see extractZip's own matching check.

type WalkedEntry = { absolutePath: string; relativePath: string; isDirectory: boolean; isSymlink: boolean };

async function walk(dir: string, baseDir: string): Promise<WalkedEntry[]> {
  const names = await readdir(dir);
  const results: WalkedEntry[] = [];
  for (const name of names) {
    if (EXCLUDED_NAMES.has(name)) continue;
    const absolutePath = join(dir, name);
    const stats = await lstat(absolutePath);
    // Zip entries are always forward-slash, regardless of the host platform's own
    // path separator — a Windows-built archive with backslash paths would silently
    // fail to extract into subdirectories on macOS/Linux.
    const relativePath = relative(baseDir, absolutePath).split(sep).join('/');
    if (stats.isSymbolicLink()) {
      results.push({ absolutePath, relativePath, isDirectory: false, isSymlink: true });
    } else if (stats.isDirectory()) {
      const children = await walk(absolutePath, baseDir);
      // Only emit a directory entry when it has no children — a non-empty directory
      // is already fully represented by its files' own relative paths; yazl has no
      // "and also this is a directory" entry a file implies the existence of.
      if (children.length === 0) {
        results.push({ absolutePath, relativePath, isDirectory: true, isSymlink: false });
      } else {
        results.push(...children);
      }
    } else {
      results.push({ absolutePath, relativePath, isDirectory: false, isSymlink: false });
    }
  }
  return results;
}

/**
 * Walks sourceDir and writes every entry into a new zip at outputPath, preserving
 * real on-disk permission bits — yazl's addFile reads them itself via fs.stat
 * whenever no explicit `mode` is given, so a regular file just needs its path.
 * Symlinks can't go through addFile at all (its own fs.stat follows them, and then
 * requires stats.isFile() — a symlink to a directory would error "not a file"), so
 * each one goes through addBuffer instead: the link target's text as content, with
 * the S_IFLNK bit set directly in mode — the exact inverse of what extractZip checks
 * on the way back out. Always skips __MACOSX/.DS_Store, at any depth — artifacts of
 * extracting/building on macOS, never part of a real .app bundle.
 */
export async function createZip(sourceDir: string, outputPath: string): Promise<void> {
  const zipFile = new ZipFile();
  const entries = await walk(sourceDir, sourceDir);

  for (const entry of entries) {
    if (entry.isDirectory) {
      zipFile.addEmptyDirectory(entry.relativePath);
    } else if (entry.isSymlink) {
      const target = await readlink(entry.absolutePath);
      zipFile.addBuffer(Buffer.from(target, 'utf8'), entry.relativePath, { mode: UNIX_SYMLINK_MODE | 0o755 });
    } else {
      zipFile.addFile(entry.absolutePath, entry.relativePath);
    }
  }

  await new Promise<void>((resolve, reject) => {
    const writeStream = createWriteStream(outputPath);
    zipFile.outputStream.pipe(writeStream);
    writeStream.on('close', resolve);
    writeStream.on('error', reject);
    zipFile.end();
  });
}
