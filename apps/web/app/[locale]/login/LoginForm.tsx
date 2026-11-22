"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { authClient } from "@/lib/authClient";
import { safeCallbackPath } from "@/lib/safeCallbackPath";
import { getMyDraft, type DraftSummary } from "@/lib/apiClient";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { PhoneMockup } from "@/components/ui/PhoneMockup";

const RESEND_SECONDS = 30;

export function LoginForm() {
  const t = useTranslations("login");
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [sentTo, setSentTo] = useState("");
  const [resendWait, setResendWait] = useState(0);
  const [draft, setDraft] = useState<DraftSummary | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getMyDraft()
      .then(setDraft)
      .catch(() => setDraft(null));
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function startResendTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    setResendWait(RESEND_SECONDS);
    timerRef.current = setInterval(() => {
      setResendWait((w) => {
        if (w <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return w - 1;
      });
    }, 1000);
  }

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

  async function sendLink(targetEmail: string) {
    setStatus("sending");
    try {
      await authClient.signIn.magicLink({ email: targetEmail, callbackURL: callbackURL() });
      setSentTo(targetEmail);
      setStatus("sent");
      startResendTimer();
    } catch {
      setStatus("error");
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    await sendLink(email.trim());
  }

  async function handleGoogle() {
    await authClient.signIn.social({ provider: "google", callbackURL: callbackURL() });
  }

  const isSent = status === "sent";

  return (
    <div className="flex min-h-full flex-1 flex-wrap bg-mist text-ink">
      <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-10 px-5 py-8 sm:px-10 lg:px-20 lg:py-10">
        <Link href="/">
          <Logo />
        </Link>

        <div className="flex flex-1 items-center">
          <div className="flex w-full max-w-[440px] flex-col gap-6">
            {!isSent ? (
              <div className="flex flex-col gap-6">
                {draft ? (
                  <div className="flex items-center gap-3 rounded-2xl bg-lilac px-4 py-3.5 text-[15px] leading-snug text-[#2A1A80]">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet font-extrabold text-white">
                      {draft.name.charAt(0).toUpperCase()}
                    </span>
                    <span>{t.rich("draftWaiting", { name: draft.name, b: (chunks) => <b>{chunks}</b> })}</span>
                  </div>
                ) : null}

                <h1 className="font-[family-name:var(--font-unbounded)] text-[32px] font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">
                  {t("title")}
                </h1>
                <p className="-mt-3 text-base leading-relaxed text-slate sm:text-[17px]">{t("subheading")}</p>

                <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
                  <Field label={t("emailLabel")}>
                    <Input
                      type="email"
                      autoComplete="email"
                      required
                      placeholder={t("emailPlaceholder")}
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      disabled={status === "sending"}
                    />
                  </Field>
                  <Button type="submit" size="md" loading={status === "sending"} disabled={!email.trim()} className="w-full">
                    {status === "sending" ? t("sending") : t("sendLink")}
                  </Button>
                  {status === "error" ? <p className="text-sm text-danger">{t("sendError")}</p> : null}
                </form>

                <div className="flex items-center gap-3 text-xs uppercase text-slate">
                  <span className="h-px flex-1 bg-line" />
                  {t("or")}
                  <span className="h-px flex-1 bg-line" />
                </div>
                <Button type="button" variant="secondary" onClick={handleGoogle} className="w-full">
                  {t("continueWithGoogle")}
                </Button>

                <p className="text-[13px] leading-relaxed text-slate">
                  {t.rich("termsNotice", {
                    terms: (chunks) => <Link href="/legal/terms">{chunks}</Link>,
                    privacy: (chunks) => <Link href="/legal/privacy">{chunks}</Link>,
                  })}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                <span aria-hidden="true" className="flex h-[72px] w-[72px] items-center justify-center rounded-[22px] bg-ink">
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#D7FF4F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="5" width="18" height="14" rx="2.5" />
                    <path d="M4 7l8 6 8-6" />
                  </svg>
                </span>
                <h1 className="font-[family-name:var(--font-unbounded)] text-[32px] font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">
                  {t("checkEmailTitle")}
                </h1>
                <p className="-mt-3 text-base leading-relaxed text-slate sm:text-[17px]">
                  {t.rich("sentTo", { email: sentTo, b: (chunks) => <b className="text-ink">{chunks}</b> })}
                </p>

                <div className="flex flex-col gap-2.5 rounded-[18px] bg-white p-4.5 text-[15px] leading-snug">
                  <span className="font-bold">{t("nothingArrived")}</span>
                  <span className="text-slate">
                    {t("lookInSpam", { fromAddress: `no-reply@${process.env.NEXT_PUBLIC_MAIL_FROM_DOMAIN ?? "mobilio.app"}` })}
                  </span>
                  <div className="mt-1 flex flex-wrap gap-2.5">
                    <Button type="button" variant="secondary" size="sm" disabled={resendWait > 0} onClick={() => sendLink(sentTo)}>
                      {resendWait > 0 ? t("resendIn", { seconds: resendWait }) : t("resendLink")}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setStatus("idle")}>
                      {t("useDifferentEmail")}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="relative hidden min-w-0 flex-[1_1_520px] items-center justify-center overflow-hidden bg-violet px-4 py-12 lg:flex">
        <div aria-hidden="true" className="pointer-events-none absolute -left-32 -top-32 h-[380px] w-[380px] rounded-full bg-white/[0.08]" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 -right-36 h-[420px] w-[420px] rounded-full bg-ink/25" />
        <div className="relative flex flex-col items-center gap-7">
          <PhoneMockup width={260} height={534} float>
            <div className="flex h-full flex-col bg-white text-ink">
              <div className="px-4 pb-2 pt-11 text-[21px] font-bold tracking-tight">Lumen</div>
              <div className="mx-4 flex h-[120px] items-end rounded-[18px] bg-[#E8794A] p-3.5 text-[17px] font-bold leading-tight text-white">
                Lamps that
                <br />
                glow softer
              </div>
              <div className="mx-4 mt-2.5 grid grid-cols-2 gap-2">
                <div className="h-20 rounded-xl bg-[#F4EFE6]" />
                <div className="h-20 rounded-xl bg-[#E6EEF4]" />
                <div className="h-20 rounded-xl bg-[#EFE6F4]" />
                <div className="h-20 rounded-xl bg-[#E6F4EC]" />
              </div>
            </div>
          </PhoneMockup>
          <p className="max-w-[360px] text-center text-[17px] leading-relaxed text-white">{t("heroTagline")}</p>
        </div>
      </div>
    </div>
  );
}
