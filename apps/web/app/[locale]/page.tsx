"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createDraft } from "@/lib/apiClient";
import { useApiErrorMessage } from "@/lib/errorCodes";

/** "/" — just enter a URL and go. The actual draft editor lives at /try, which reads back whatever createDraft() just created via getMyDraft(). */
export default function HomePage() {
  const t = useTranslations("home");
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();
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

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4">
      <main className="w-full max-w-md text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">{t("title")}</h1>
        <p className="mt-2 text-zinc-600">{t("subtitle")}</p>

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-3">
          <input
            type="text"
            inputMode="url"
            placeholder={t("urlPlaceholder")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
            className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-base text-zinc-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="w-full rounded-xl bg-blue-600 px-4 py-3 text-base font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? t("submitLoading") : t("submit")}
          </button>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </form>
      </main>
    </div>
  );
}
