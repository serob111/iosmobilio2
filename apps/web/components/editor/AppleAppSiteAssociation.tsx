"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

// Public by design — an Apple Team ID is never secret (it's already visible inside
// every signed .ipa's own entitlements, and inside this very file once a client
// uploads it to their domain). Same NEXT_PUBLIC_ convention as NEXT_PUBLIC_ABUSE_EMAIL/
// NEXT_PUBLIC_ENABLE_BUILDS.
const APPLE_TEAM_ID = process.env.NEXT_PUBLIC_APPLE_TEAM_ID ?? "";

function buildAppleAppSiteAssociation(teamId: string, bundleId: string): string {
  return JSON.stringify({ applinks: { apps: [], details: [{ appID: `${teamId}.${bundleId}`, paths: ["*"] }] } }, null, 2);
}

type Props = {
  bundleId: string;
  allowedDomains: string[];
};

/**
 * Shown next to the Deep Links toggle once it's on — we don't host this file
 * ourselves (it has to live on the client's own domain, not ours), so this is purely a
 * "here's the exact content, here's where it goes" display, not a live endpoint.
 */
export function AppleAppSiteAssociation({ bundleId, allowedDomains }: Props) {
  const t = useTranslations("editor");
  const [copied, setCopied] = useState(false);

  // No Apple Team ID configured in this environment at all — nothing useful to show.
  if (!APPLE_TEAM_ID) return null;

  const content = buildAppleAppSiteAssociation(APPLE_TEAM_ID, bundleId);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (non-HTTPS context, permission denied, …) — the
      // content itself is already selectable/visible below.
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <p className="text-xs text-zinc-600">{t("deepLinksInstructions")}</p>
      {allowedDomains.length > 0 ? (
        <ul className="list-disc pl-4 text-xs text-zinc-600">
          {allowedDomains.map((domain) => (
            <li key={domain}>
              <code>https://{domain}/.well-known/apple-app-site-association</code>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-zinc-500">{t("deepLinksNoDomains")}</p>
      )}
      <pre className="overflow-x-auto rounded-lg border border-zinc-200 bg-white p-3 font-mono text-xs text-zinc-700">{content}</pre>
      <button
        type="button"
        onClick={handleCopy}
        className="self-start rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold text-[#17112E] hover:bg-zinc-50"
      >
        {copied ? t("deepLinksCopied") : t("deepLinksCopy")}
      </button>
    </div>
  );
}
