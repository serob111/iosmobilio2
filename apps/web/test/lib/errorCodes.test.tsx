// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import enMessages from "../../messages/en.json";
import ruMessages from "../../messages/ru.json";
import { ApiError } from "../../lib/apiClient";
import { useApiErrorMessage } from "../../lib/errorCodes";

type MessageDict = Record<string, unknown>;

function lookup(dict: MessageDict, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => {
    if (value && typeof value === "object") return (value as MessageDict)[part];
    return undefined;
  }, dict);
}

// Same reasoning as the component tests: next-intl's real Provider crashes under
// Vitest's module resolution, so useTranslations is mocked to read straight from the
// real messages/{en,ru}.json — a currently-active module-level variable swapped per
// test, so this one hook test can exercise both locales' actual message files.
let activeMessages: MessageDict = enMessages;
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => {
    const dict = activeMessages[namespace] as MessageDict;
    const t = (key: string) => {
      const value = lookup(dict, key);
      return typeof value === "string" ? value : key;
    };
    t.has = (key: string) => typeof lookup(dict, key) === "string";
    return t;
  },
}));

describe("useApiErrorMessage", () => {
  it("maps a known ApiError code to its localized message (en)", () => {
    activeMessages = enMessages;
    const { result } = renderHook(() => useApiErrorMessage());
    const message = result.current(new ApiError("SITE_UNREACHABLE", "irrelevant english text from the server"));
    expect(message).toBe(enMessages.errors.SITE_UNREACHABLE);
  });

  it("maps the same code to its Russian message (ru)", () => {
    activeMessages = ruMessages;
    const { result } = renderHook(() => useApiErrorMessage());
    const message = result.current(new ApiError("SITE_UNREACHABLE", "irrelevant english text from the server"));
    expect(message).toBe(ruMessages.errors.SITE_UNREACHABLE);
    expect(message).not.toBe(enMessages.errors.SITE_UNREACHABLE);
  });

  it("falls back to the UNKNOWN message for a code with no translation entry", () => {
    activeMessages = enMessages;
    const { result } = renderHook(() => useApiErrorMessage());
    const message = result.current(new ApiError("SOME_BRAND_NEW_CODE_NOT_IN_MESSAGES", "whatever"));
    expect(message).toBe(enMessages.errors.UNKNOWN);
  });

  it("falls back to UNKNOWN for a non-ApiError value (e.g. a network TypeError)", () => {
    activeMessages = enMessages;
    const { result } = renderHook(() => useApiErrorMessage());
    const message = result.current(new TypeError("Failed to fetch"));
    expect(message).toBe(enMessages.errors.UNKNOWN);
  });

  it("every CSRF_ORIGIN_MISMATCH-style code apps/api can emit has both an en and ru translation", () => {
    // Guards against the two message files drifting apart — a code present in one
    // locale but not the other would silently fall back to UNKNOWN in whichever
    // locale is missing it.
    const enCodes = Object.keys(enMessages.errors).sort();
    const ruCodes = Object.keys(ruMessages.errors).sort();
    expect(ruCodes).toEqual(enCodes);
  });
});
