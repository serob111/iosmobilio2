"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { useTranslations } from "next-intl";

type Props = {
  /** The current active share link, if any — null (not an error) when none exists yet. */
  fetchLink: () => Promise<{ url: string } | null>;
  /** Creates a share link only if none is active; returns the existing one otherwise. */
  createLink: () => Promise<{ url: string }>;
  /** Explicitly revokes the active share link and creates a new one. */
  regenerateLink: () => Promise<{ url: string }>;
};

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; url: string; qrDataUrl: string }
  | { status: "error" };

/**
 * "Открыть на iPhone" — shows the project/draft's share link (the one capability URL a
 * user actually copies/sends out), fetching the existing active one first and only
 * creating a new one if there isn't one yet (never on every click — that used to also be
 * what the editor's own live-preview iframe called, so opening this button would silently
 * revoke the link the iframe was using and vice versa; the two are now entirely separate
 * endpoints/kinds, see preview-link.service.ts). "Generate new link" explicitly revokes
 * the shown link and replaces it, behind a confirmation step since that breaks whatever
 * the old link was already sent to. Shared between the draft flow and the project page so
 * the QR/copy UI and clipboard-fallback logic exist in exactly one place.
 */
export function PreviewLinkButton({ fetchLink, createLink, regenerateLink }: Props) {
  const t = useTranslations("preview");
  const [state, setState] = useState<State>({ status: "idle" });
  const [copied, setCopied] = useState(false);
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);

  async function showLink(url: string): Promise<void> {
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 196 });
    setState({ status: "ready", url, qrDataUrl });
  }

  async function handleClick() {
    setState({ status: "loading" });
    try {
      const existing = await fetchLink();
      const link = existing ?? (await createLink());
      await showLink(link.url);
    } catch {
      setState({ status: "error" });
    }
  }

  async function handleRegenerateConfirmed() {
    setConfirmingRegenerate(false);
    setState({ status: "loading" });
    try {
      const { url } = await regenerateLink();
      await showLink(url);
    } catch {
      setState({ status: "error" });
    }
  }

  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (non-HTTPS context, permission denied, …) — the link
      // text itself is already selectable/visible, so there's nothing further to do.
    }
  }

  if (state.status === "ready") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 p-4 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- a data: URI generated client-side, not a static asset */}
        <img src={state.qrDataUrl} alt={t("qrAlt")} width={196} height={196} />
        <div className="flex items-center gap-2">
          <a href={state.url} target="_blank" rel="noopener noreferrer" className="text-sm text-[#4B2BE0] underline">
            {state.url}
          </a>
          <button
            type="button"
            onClick={() => handleCopy(state.url)}
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold text-[#17112E] hover:bg-zinc-50"
          >
            {copied ? t("copied") : t("copyLink")}
          </button>
        </div>
        {confirmingRegenerate ? (
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs text-zinc-600">{t("regenerateConfirm")}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleRegenerateConfirmed}
                className="rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700"
              >
                {t("regenerateConfirmYes")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingRegenerate(false)}
                className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold text-[#17112E] hover:bg-zinc-50"
              >
                {t("regenerateConfirmNo")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingRegenerate(true)}
            className="text-xs font-medium text-zinc-500 underline hover:text-zinc-700"
          >
            {t("regenerateLink")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={state.status === "loading"}
        className="rounded-full bg-[#4B2BE0] px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {state.status === "loading" ? t("preparingLink") : t("openOnIphone")}
      </button>
      {state.status === "error" ? <p className="text-xs text-red-600">{t("linkError")}</p> : null}
    </div>
  );
}
