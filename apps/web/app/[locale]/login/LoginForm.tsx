"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/authClient";
import { safeCallbackPath } from "@/lib/safeCallbackPath";

export function LoginForm() {
  const t = useTranslations("login");
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  // Lets a flow like /try's "save as project" button send the user back to exactly
  // where they started (including the locale prefix, since this is the real browser
  // path, not next-intl's own locale-stripped one) instead of always landing on "/".
  // callbackUrl is attacker-controlled (it's a query param anyone can craft into a
  // /login link) — safeCallbackPath rejects anything that isn't a same-origin relative
  // path before it's concatenated into the actual sign-in redirect target.
  function callbackURL(): string {
    const safePath = safeCallbackPath(searchParams.get("callbackUrl"), window.location.origin);
    return safePath ? `${window.location.origin}${safePath}` : window.location.origin;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setStatus("sending");
    try {
      await authClient.signIn.magicLink({ email, callbackURL: callbackURL() });
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  async function handleGoogle() {
    await authClient.signIn.social({ provider: "google", callbackURL: callbackURL() });
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-[#F3F0FF] px-4 py-12">
      <main className="w-full max-w-sm rounded-[28px] bg-white p-8 text-center shadow-sm">
        <h1 className="font-[family-name:var(--font-unbounded)] text-2xl font-extrabold tracking-tight text-[#17112E]">
          {t("title")}
        </h1>

        {status === "sent" ? (
          <p className="mt-8 rounded-2xl bg-[#F3F0FF] p-4 text-sm text-[#17112E]">{t("sent")}</p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-3">
            <input
              type="email"
              required
              placeholder={t("emailPlaceholder")}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={status === "sending"}
              className="w-full rounded-full border border-zinc-300 px-4 py-3 text-base text-[#17112E] outline-none focus:border-[#4B2BE0] disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={status === "sending" || !email.trim()}
              className="w-full rounded-full bg-[#4B2BE0] px-4 py-3 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === "sending" ? t("sending") : t("sendLink")}
            </button>
            {status === "error" ? <p className="text-sm text-red-600">{t("sendError")}</p> : null}
          </form>
        )}

        <div className="mt-6 flex items-center gap-3 text-xs uppercase text-zinc-400">
          <span className="h-px flex-1 bg-zinc-200" />
          {t("or")}
          <span className="h-px flex-1 bg-zinc-200" />
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          className="mt-6 w-full rounded-full border border-zinc-300 px-4 py-3 text-base font-semibold text-[#17112E] hover:bg-zinc-50"
        >
          {t("continueWithGoogle")}
        </button>
      </main>
    </div>
  );
}
