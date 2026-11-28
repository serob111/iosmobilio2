import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertWithinDestDir } from '../src/extract';

const DEST_DIR = join('dest');

describe('assertWithinDestDir', () => {
  it('allows a normal, nested entry path', () => {
    const fileName = 'MyApp.app/Info.plist';
    expect(() => assertWithinDestDir(join(DEST_DIR, fileName), DEST_DIR, fileName)).not.toThrow();
  });

  it('allows a deeply nested entry path', () => {
    const fileName = 'Frameworks/React.framework/React';
    expect(() => assertWithinDestDir(join(DEST_DIR, fileName), DEST_DIR, fileName)).not.toThrow();
  });

  it('rejects a zip-slip attempt via a leading "../" segment', () => {
    const fileName = '../evil.txt';
    expect(() => assertWithinDestDir(join(DEST_DIR, fileName), DEST_DIR, fileName)).toThrow(
      /outside the extraction directory/,
    );
  });

  it('rejects a zip-slip attempt buried deeper in the path', () => {
    const fileName = 'MyApp.app/../../evil.txt';
    expect(() => assertWithinDestDir(join(DEST_DIR, fileName), DEST_DIR, fileName)).toThrow(
      /outside the extraction directory/,
    );
  });
});
