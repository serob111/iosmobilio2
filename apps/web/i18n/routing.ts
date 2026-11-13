import { defineRouting } from "next-intl/routing";

/**
 * "as-needed" — the default locale (en) has no URL prefix at all (/try, /preview/abc),
 * so every existing link already shared externally (preview QR codes/URLs, built by
 * apps/api's own previewUrl() helper with no locale awareness) keeps working unchanged.
 * Only ru gets a visible prefix (/ru/try).
 */
export const routing = defineRouting({
  locales: ["en", "ru"],
  defaultLocale: "en",
  localePrefix: "as-needed",
});
