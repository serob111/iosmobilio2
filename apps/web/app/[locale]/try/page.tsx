"use client";

import { useEffect, useState } from "react";
import { usePathname as useNextPathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  claimDraft,
  createDraftEditorPreviewLink,
  createDraftPreviewLink,
  fetchDraftPreviewLink,
  fetchMe,
  fetchPreviewDto,
  getMyDraft,
  regenerateDraftPreviewLink,
  type DraftSummary,
  type MeResponse,
} from "@/lib/apiClient";
import { useApiErrorMessage } from "@/lib/errorCodes";
import { ProjectEditor } from "@/components/editor/ProjectEditor";
import { createDraftAdapter } from "@/components/editor/DraftAdapter";
import type { ProjectEditorAdapter } from "@/components/editor/types";
import { PreviewLinkButton } from "@/components/preview/PreviewLinkButton";

type LoadState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; draft: DraftSummary; adapter: ProjectEditorAdapter };

/**
 * The draft editor — assumes "/" already created a draft via createDraft(); this page
 * only ever reads it back (getMyDraft()). The editor's own live-preview iframe link
 * (createDraftEditorPreviewLink) is created fresh on every mount and never revokes
 * anything — it's a distinct 'editor'-kind link from the 'share'-kind one
 * PreviewLinkButton manages below, so opening/reloading this page never invalidates a
 * share link the user already copied/sent (see preview-link.service.ts).
 */
export default function TryPage() {
  const t = useTranslations("claim");
  const router = useRouter();
  const pathname = useNextPathname();
  const apiErrorMessage = useApiErrorMessage();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [me, setMe] = useState<MeResponse | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const draft = await getMyDraft();
      if (cancelled) return;
      if (!draft) {
        setState({ status: "missing" });
        return;
      }
      const { url } = await createDraftEditorPreviewLink();
      if (cancelled) return;
      const slug = url.split("/preview/")[1];
      const dto = slug ? await fetchPreviewDto(slug) : null;
      if (cancelled) return;
      if (!dto) {
        setState({ status: "missing" });
        return;
      }
      setState({ status: "ready", draft, adapter: createDraftAdapter(dto.proxyBase, draft.config) });
    })().catch(() => {
      if (!cancelled) setState({ status: "missing" });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((result) => {
        if (cancelled) return;
        setMe(result);
        if (result && result.organizations.length > 0) {
          setSelectedOrgId(result.organizations[0]!.id);
        }
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.status === "missing") {
      router.replace("/");
    }
  }, [state.status, router]);

  async function handleClaim() {
    if (!selectedOrgId) return;
    setClaiming(true);
    setClaimError(null);
    try {
      const { id } = await claimDraft(selectedOrgId);
      router.push(`/projects/${selectedOrgId}/${id}`);
    } catch (error) {
      setClaimError(apiErrorMessage(error));
      setClaiming(false);
    }
  }

  if (state.status !== "ready") {
    return null;
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-6 bg-zinc-50 pb-12">
      <ProjectEditor adapter={state.adapter} />
      <PreviewLinkButton
        fetchLink={fetchDraftPreviewLink}
        createLink={createDraftPreviewLink}
        regenerateLink={regenerateDraftPreviewLink}
      />

      {me === null ? (
        <Link href={{ pathname: "/login", query: { callbackUrl: pathname } }} className="text-sm font-medium text-[#4B2BE0] underline">
          {t("saveAsProject")}
        </Link>
      ) : (
        <div className="flex flex-col items-center gap-2">
          {me.organizations.length > 1 ? (
            <select
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              aria-label={t("chooseOrganization")}
              className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-sm text-[#17112E]"
            >
              {me.organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            onClick={handleClaim}
            disabled={claiming || !selectedOrgId}
            className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-semibold text-[#17112E] hover:bg-zinc-50 disabled:opacity-50"
          >
            {claiming ? t("saving") : t("saveAsProject")}
          </button>
          {claimError ? <p className="text-sm text-red-600">{claimError}</p> : null}
        </div>
      )}
    </div>
  );
}
