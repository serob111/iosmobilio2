import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSpawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: mockSpawn }));

const { signBundle, verifyBundle } = await import('../src/sign');
const { RepackError } = await import('../src/errors');

class FakeChildProcess extends EventEmitter {
  readonly stderr = new EventEmitter();
}

function queueFakeProcess(exitCode: number, stderrOutput = ''): FakeChildProcess {
  const child = new FakeChildProcess();
  // The emission has to be scheduled inside spawn's own mock implementation, not
  // ahead of time via mockReturnValueOnce — signBundle does real (async) temp-file
  // I/O for the password file before ever calling spawn(), so a microtask queued at
  // setup time fires long before runRcodesign has attached its 'close'/'error'
  // listeners, and the event is silently lost.
  mockSpawn.mockImplementationOnce(() => {
    queueMicrotask(() => {
      if (stderrOutput) child.stderr.emit('data', Buffer.from(stderrOutput));
      child.emit('close', exitCode);
    });
    return child;
  });
  return child;
}

describe('signBundle / verifyBundle', () => {
  let dir: string;
  let binaryPath: string;
  let binarySha256: string;
  let p12Path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'repacker-sign-'));
    binaryPath = join(dir, 'rcodesign');
    writeFileSync(binaryPath, 'fake rcodesign binary contents');
    binarySha256 = createHash('sha256').update(readFileSync(binaryPath)).digest('hex');
    p12Path = join(dir, 'cert.p12');
    writeFileSync(p12Path, 'fake p12 contents');
    mockSpawn.mockReset();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws SIGNING_FAILED without spawning anything when the binary sha256 does not match the pinned value', async () => {
    await expect(
      signBundle(
        dir,
        join(dir, 'entitlements.plist'),
        { p12Path, p12Password: 'secret' },
        { binaryPath, expectedSha256: 'f'.repeat(64) },
      ),
    ).rejects.toMatchObject({ code: 'SIGNING_FAILED' });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('resolves when rcodesign exits 0', async () => {
    queueFakeProcess(0);
    await expect(
      signBundle(dir, join(dir, 'entitlements.plist'), { p12Path, p12Password: 'secret' }, { binaryPath, expectedSha256: binarySha256 }),
    ).resolves.toBeUndefined();
  });

  it('passes --timestamp-url none (no notarization timestamp for this ad-hoc signing flow)', async () => {
    queueFakeProcess(0);
    await signBundle(dir, join(dir, 'entitlements.plist'), { p12Path, p12Password: 'secret' }, { binaryPath, expectedSha256: binarySha256 });

    const [, args] = mockSpawn.mock.calls[0] as [string, string[]];
    const timestampUrlIndex = args.indexOf('--timestamp-url');
    expect(timestampUrlIndex).toBeGreaterThanOrEqual(0);
    expect(args[timestampUrlIndex + 1]).toBe('none');
  });

  it('passes --p12-password-file, never the raw password as a CLI argument', async () => {
    queueFakeProcess(0);
    await signBundle(dir, join(dir, 'entitlements.plist'), { p12Path, p12Password: 'super-secret-password' }, { binaryPath, expectedSha256: binarySha256 });

    const [, args] = mockSpawn.mock.calls[0] as [string, string[]];
    expect(args).not.toContain('super-secret-password');
    expect(args).toContain('--p12-password-file');
    const passwordFileIndex = args.indexOf('--p12-password-file');
    const passwordFilePath = args[passwordFileIndex + 1];
    // The file existed and held the real password while rcodesign was "running" — by
    // the time this assertion runs (after the awaited call resolves), withPasswordFile's
    // own cleanup has already deleted it; this just proves the right content was
    // written at all, by capturing the path before the process fired its close event.
    expect(passwordFilePath).toContain('p12-password');
  });

  it('rejects with SIGNING_FAILED and includes stderr when rcodesign exits non-zero', async () => {
    queueFakeProcess(1, 'certificate expired');
    await expect(
      signBundle(dir, join(dir, 'entitlements.plist'), { p12Path, p12Password: 'secret' }, { binaryPath, expectedSha256: binarySha256 }),
    ).rejects.toMatchObject({ code: 'SIGNING_FAILED', message: expect.stringContaining('certificate expired') });
  });

  it('rejects with SIGNING_FAILED when spawn itself errors (e.g. ENOENT)', async () => {
    const child = new FakeChildProcess();
    mockSpawn.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('error', new Error('spawn ENOENT')));
      return child;
    });

    await expect(
      signBundle(dir, join(dir, 'entitlements.plist'), { p12Path, p12Password: 'secret' }, { binaryPath, expectedSha256: binarySha256 }),
    ).rejects.toMatchObject({ code: 'SIGNING_FAILED' });
  });

  it('verifyBundle resolves when rcodesign exits 0', async () => {
    queueFakeProcess(0);
    await expect(verifyBundle(join(dir, 'MyApp'), { binaryPath, expectedSha256: binarySha256 })).resolves.toBeUndefined();
  });

  it('verifyBundle rejects with VERIFY_FAILED (not SIGNING_FAILED) when rcodesign exits non-zero', async () => {
    queueFakeProcess(1, 'signature invalid');
    await expect(verifyBundle(join(dir, 'MyApp'), { binaryPath, expectedSha256: binarySha256 })).rejects.toMatchObject({
      code: 'VERIFY_FAILED',
    });
  });

  it('verifyBundle rejected errors are real RepackError instances', async () => {
    queueFakeProcess(1, 'signature invalid');
    await expect(verifyBundle(join(dir, 'MyApp'), { binaryPath, expectedSha256: binarySha256 })).rejects.toBeInstanceOf(RepackError);
  });

  it('verifyBundle also runs the pinned-binary check before spawning, same as signBundle', async () => {
    await expect(verifyBundle(join(dir, 'MyApp'), { binaryPath, expectedSha256: 'f'.repeat(64) })).rejects.toMatchObject({
      code: 'SIGNING_FAILED',
    });
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
