"use client";

import { useState } from "react";
import QRCode from "qrcode";

type Props = {
  createLink: () => Promise<{ url: string }>;
};

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; url: string; qrDataUrl: string }
  | { status: "error" };

/**
 * "Открыть на iPhone" — creates (or regenerates) a capability-URL preview link on demand,
 * then renders its QR code (client-side, via the `qrcode` package — no image round-trip
 * through apps/api for this) plus a copy-to-clipboard button. Shared between the draft
 * flow and the project page so the QR/copy UI and clipboard-fallback logic exist in
 * exactly one place.
 */
export function PreviewLinkButton({ createLink }: Props) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    setState({ status: "loading" });
    try {
      const { url } = await createLink();
      const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 196 });
      setState({ status: "ready", url, qrDataUrl });
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
        <img src={state.qrDataUrl} alt="QR-код превью" width={196} height={196} />
        <div className="flex items-center gap-2">
          <a href={state.url} target="_blank" rel="noopener noreferrer" className="text-sm text-[#4B2BE0] underline">
            {state.url}
          </a>
          <button
            type="button"
            onClick={() => handleCopy(state.url)}
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold text-[#17112E] hover:bg-zinc-50"
          >
            {copied ? "Скопировано" : "Копировать"}
          </button>
        </div>
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
        {state.status === "loading" ? "Готовим ссылку…" : "Открыть на iPhone"}
      </button>
      {state.status === "error" ? (
        <p className="text-xs text-red-600">Не удалось создать ссылку. Попробуйте ещё раз.</p>
      ) : null}
    </div>
  );
}
