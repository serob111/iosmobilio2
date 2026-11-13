/**
 * Validates a `callbackUrl` query param as a safe, same-origin relative path before it's
 * ever concatenated onto an origin and handed to better-auth's callbackURL (magic
 * link/OAuth) — an unvalidated value here is an open redirect: whoever controls the
 * query string (anyone who can get a victim to click a crafted /login link) controls
 * where the sign-in flow ultimately sends them.
 *
 * Rejects anything that isn't a bare relative path: must start with "/", must not start
 * with "//" (protocol-relative) or "/\" (a backslash is normalized to "/" by some URL
 * parsers, making "/\evil.com" equivalent to "//evil.com"). The final `new URL(path,
 * origin)` + origin check is defense in depth on top of those two string checks, not a
 * replacement for them — it catches anything the prefix checks didn't anticipate.
 *
 * Returns `""` (not origin, not null) when invalid — callers fall back to a bare origin
 * themselves, keeping "what the safe default is" a caller decision.
 */
export function safeCallbackPath(raw: string | null, origin: string): string {
  if (!raw) return "";
  if (!raw.startsWith("/")) return "";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "";
  try {
    const parsed = new URL(raw, origin);
    if (parsed.origin !== origin) return "";
  } catch {
    return "";
  }
  return raw;
}
