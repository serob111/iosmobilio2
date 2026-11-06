import { describe, expect, it } from "vitest";
import { safeCallbackPath } from "../../lib/safeCallbackPath";

const ORIGIN = "http://localhost:3100";

describe("safeCallbackPath", () => {
  it("returns a plain relative path unchanged", () => {
    expect(safeCallbackPath("/try", ORIGIN)).toBe("/try");
  });

  it("returns a locale-prefixed path with query string unchanged", () => {
    expect(safeCallbackPath("/en/projects/org1/p1?tab=builds", ORIGIN)).toBe("/en/projects/org1/p1?tab=builds");
  });

  it('returns "" for null (no callbackUrl given at all)', () => {
    expect(safeCallbackPath(null, ORIGIN)).toBe("");
  });

  it('returns "" for an empty string', () => {
    expect(safeCallbackPath("", ORIGIN)).toBe("");
  });

  it('rejects a bare host with no leading slash ("@evil.com")', () => {
    expect(safeCallbackPath("@evil.com", ORIGIN)).toBe("");
  });

  it('rejects a protocol-relative url ("//evil.com")', () => {
    expect(safeCallbackPath("//evil.com", ORIGIN)).toBe("");
  });

  it('rejects a backslash-based bypass ("/\\evil.com")', () => {
    expect(safeCallbackPath("/\\evil.com", ORIGIN)).toBe("");
  });

  it('rejects a fully-qualified foreign-origin url ("https://evil.com")', () => {
    expect(safeCallbackPath("https://evil.com", ORIGIN)).toBe("");
  });

  it("rejects a fully-qualified foreign-origin url even with a matching path", () => {
    expect(safeCallbackPath("https://evil.com/try", ORIGIN)).toBe("");
  });
});
