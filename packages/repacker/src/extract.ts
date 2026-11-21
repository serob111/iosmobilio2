import { createWriteStream } from 'node:fs';
import { chmod, mkdir, symlink } from 'node:fs/promises';
import { dirname, join, relative, resolve as resolvePath } from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as yauzl from 'yauzl';

const UNIX_SYMLINK_MODE = 0o120000; // S_IFLNK, the file-type bits yauzl's externalFileAttributes carries for a symlinked zip entry.

/**
 * Streams every entry out of a .app-containing .ipa into destDir, preserving each
 * entry's own unix permission bits — losing these would silently strip the
 * executable bit off every Mach-O binary in the archive (the main executable, every
 * nested .framework's own binary), which Xcode always sets but a naive extractor has
 * no reason to default to. openPromise() always sets lazyEntries internally, so
 * eachEntry() here processes one entry fully (including its own async read) before
 * moving to the next, rather than racing concurrent reads against this same zip's
 * single underlying file descriptor.
 */
export async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const resolvedDestDir = resolvePath(destDir);
  const zipFile = await yauzl.openPromise(zipPath);
  try {
    for await (const entry of zipFile.eachEntry()) {
      await extractEntry(zipFile, entry, resolvedDestDir);
    }
  } finally {
    zipFile.close();
  }
}

/**
 * Resolves both paths itself rather than trusting the caller to have already done
 * so — comparing a resolved (absolute) candidate against an unresolved (possibly
 * relative) entryPath would otherwise never match, failing every entry, not just
 * malicious ones.
 *
 * Exported for direct unit testing — yazl itself rejects any ".." segment outright
 * (see createZip), so there's no way to produce a malicious test zip through this
 * package's own write path to exercise this defensively against. A hand-rolled or
 * third-party-built .ipa has no such guarantee.
 */
export function assertWithinDestDir(entryPath: string, destDir: string, fileName: string): void {
  const resolvedDestDir = resolvePath(destDir);
  const resolvedEntryPath = resolvePath(entryPath);
  const rel = relative(resolvedDestDir, resolvedEntryPath);
  if (rel.startsWith('..') || resolvePath(resolvedDestDir, rel) !== resolvedEntryPath) {
    throw new Error(`zip entry "${fileName}" resolves outside the extraction directory`);
  }
}

async function extractEntry(zipFile: yauzl.ZipFile, entry: yauzl.Entry, destDir: string): Promise<void> {
  const entryPath = join(destDir, entry.fileName);
  assertWithinDestDir(entryPath, destDir, entry.fileName);

  // The permission bits (and symlink file-type bit) live in the top 16 bits of
  // externalFileAttributes — the low 16 bits are DOS attributes, irrelevant here since
  // every entry in a macOS-built .ipa was written by a unix zip tool.
  const unixMode = entry.externalFileAttributes >>> 16;
  const permissionBits = unixMode & 0o7777;

  if (entry.fileName.endsWith('/')) {
    await mkdir(entryPath, { recursive: true });
    return;
  }

  await mkdir(dirname(entryPath), { recursive: true });

  if ((unixMode & 0o170000) === UNIX_SYMLINK_MODE) {
    // A symlink entry's "content" is the link target path itself, not file bytes —
    // CocoaPods-built frameworks commonly symlink their binary inside a
    // Versions/Current layout, so these do show up in a real .app.
    const target = await readEntryAsUtf8(zipFile, entry);
    await symlink(target, entryPath);
    return;
  }

  const readStream = await zipFile.openReadStreamPromise(entry);
  await pipeline(readStream, createWriteStream(entryPath));

  if (permissionBits) {
    await chmod(entryPath, permissionBits);
  }
}

async function readEntryAsUtf8(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<string> {
  const stream = await zipFile.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
