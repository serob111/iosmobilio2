"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createDraft } from "@/lib/apiClient";
import { useApiErrorMessage } from "@/lib/errorCodes";

export interface SiteUrlFormProps {
  id?: string;
  variant?: "hero" | "cta";
}

/**
 * The "paste your site, get an app" form — appears twice on the landing page (hero and
 * final CTA), both going through the same createDraft() -> /try flow as the pre-redesign
 * home page. Deliberately not replicating the mock's cycling-placeholder animation: e2e
 * (and real users on slow connections) rely on the placeholder being the static,
 * translated string at the moment they interact with it.
 */
export function SiteUrlForm({ id, variant = "hero" }: SiteUrlFormProps) {
  const t = useTranslations("home");
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();
  const inputId = useId();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await createDraft(url.trim());
      router.push("/try");
    } catch (err) {
      setError(apiErrorMessage(err));
      setLoading(false);
    }
  }

  const isHero = variant === "hero";

  return (
    <form id={id} onSubmit={handleSubmit} className="flex w-full flex-col items-center gap-2">
      <label htmlFor={inputId} className="sr-only">
        {t("title")}
      </label>
      <div className={["flex w-full gap-2 rounded-pill bg-white p-1.5", isHero ? "sm:max-w-[540px]" : ""].join(" ")}>
        <input
          id={inputId}
          // Deliberately type="text", not "url" like the mock — type="url" enables the
          // browser's native constraint validation, which requires a scheme (https://…)
          // and silently blocks the native submit event for a bare domain like
          // "example.com", the single most common way people actually type an address
          // here. Same as the pre-redesign home page; createDraft()'s own validation is
          // the real gate, not the browser's.
          type="text"
          inputMode="url"
          placeholder={t("urlPlaceholder")}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          disabled={loading}
          className="h-[50px] min-w-0 flex-1 rounded-pill border-0 bg-transparent px-5 text-[17px] text-ink outline-none placeholder:text-slate/70 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={loading || !url.trim()}
          className="h-[50px] shrink-0 rounded-pill border-0 bg-ink px-6 text-base font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? t("submitLoading") : t("submit")}
        </button>
      </div>
      {error ? <p className="text-sm font-medium text-white">{error}</p> : null}
    </form>
  );
}
