import { useTranslations } from "next-intl";
import { ApiError } from "./apiClient";

/**
 * The one place that maps an apps/api error `code` to a localized string — every actual
 * translated string lives in messages/{en,ru}.json under the "errors" namespace, keyed
 * by the code itself; this just picks the right key (falling back to "UNKNOWN" for a
 * code with no translation yet) rather than letting next-intl throw for a missing key.
 */
export function useApiErrorMessage(): (error: unknown) => string {
  const t = useTranslations("errors");
  return (error: unknown) => {
    const code = error instanceof ApiError ? error.code : "UNKNOWN";
    return t.has(code) ? t(code) : t("UNKNOWN");
  };
}
