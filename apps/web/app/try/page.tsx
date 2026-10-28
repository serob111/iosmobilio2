"use client";

import { useState } from "react";
import {
  claimDraft,
  createDraft,
  createDraftPreviewLink,
  fetchMe,
  fetchPreviewDto,
  getMyDraft,
  type PreviewDto,
} from "@/lib/apiClient";
import { PreviewShell } from "@/components/preview/PreviewShell";
import { PreviewLinkButton } from "@/components/preview/PreviewLinkButton";

const CURRENT_ORG_STORAGE_KEY = "mobilio.currentOrgId";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; name: string; dto: PreviewDto }
  | { status: "error"; message: string };

/**
 * Minimal, narrowly-scoped draft flow — enter a URL, see it live inside the app shell
 * right away. Deliberately NOT a port of the legacy /p/[id] editing experience (no
 * theme/tabs editor, no icon upload): that migration is its own, separate step. This
 * exists only to exercise the preview feature end to end (api draft -> preview link ->
 * proxied iframe) from a real page, and to give the Playwright e2e test a URL-to-preview
 * path to drive.
 */
export default function TryPage() {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const [signedIn, setSignedIn] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimedProjectId, setClaimedProjectId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim()) return;
    setState({ status: "loading" });
    try {
      await createDraft(url.trim());
      const draft = await getMyDraft();
      if (!draft) throw new Error("Черновик не найден после создания");
      const { url: previewUrl } = await createDraftPreviewLink();
      const slug = previewUrl.split("/preview/")[1];
      const dto = slug ? await fetchPreviewDto(slug) : null;
      if (!dto) throw new Error("Не удалось загрузить превью");
      setState({ status: "ready", name: draft.name, dto });

      const me = await fetchMe();
      if (me && me.organizations.length > 0) {
        setSignedIn(true);
        const stored = window.localStorage.getItem(CURRENT_ORG_STORAGE_KEY);
        const valid = me.organizations.some((org) => org.id === stored);
        setOrgId(valid && stored ? stored : me.organizations[0]!.id);
      }
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "Не удалось создать черновик" });
    }
  }

  async function handleClaim() {
    if (!orgId) return;
    setClaiming(true);
    try {
      const { id } = await claimDraft(orgId);
      setClaimedProjectId(id);
    } catch {
      // Claiming is a secondary action here — a failure just leaves the button
      // clickable again, the draft itself is unaffected.
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-8 bg-zinc-50 px-4 py-12">
      <main className="w-full max-w-md text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">Превью приложения</h1>
        <p className="mt-2 text-zinc-600">Вставьте адрес сайта — увидите его в оболочке приложения прямо здесь</p>

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-3">
          <input
            type="text"
            inputMode="url"
            placeholder="Адрес вашего сайта, например example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={state.status === "loading"}
            className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-base text-zinc-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={state.status === "loading" || !url.trim()}
            className="w-full rounded-xl bg-blue-600 px-4 py-3 text-base font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state.status === "loading" ? "Анализируем сайт…" : "Показать превью"}
          </button>
          {state.status === "error" ? <p className="text-sm text-red-600">{state.message}</p> : null}
        </form>
      </main>

      {state.status === "ready" ? (
        <div className="flex w-full flex-col items-center gap-6">
          <PreviewShell dto={state.dto} />
          <PreviewLinkButton createLink={createDraftPreviewLink} />
          {signedIn && orgId ? (
            claimedProjectId ? (
              <a href={`/projects/${orgId}/${claimedProjectId}`} className="text-sm text-[#4B2BE0] underline">
                Открыть сохранённый проект
              </a>
            ) : (
              <button
                type="button"
                onClick={handleClaim}
                disabled={claiming}
                className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-semibold text-[#17112E] hover:bg-zinc-50 disabled:opacity-50"
              >
                {claiming ? "Сохраняем…" : "Сохранить как проект"}
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
