import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import ru from "../../messages/ru.json";

const PLACEHOLDER = /\[[A-Z][A-Z _-]*\]/;
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("Part A copy", () => {
  it.each([["en", en], ["ru", ru]] as const)("contains no unresolved placeholders in %s", (_locale, messages) => {
    expect(strings(messages).filter(value => PLACEHOLDER.test(value))).toEqual([]);
  });
});
