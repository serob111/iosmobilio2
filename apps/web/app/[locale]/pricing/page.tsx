"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { PublicHeader } from "@/components/ui/PublicHeader";
import { Footer } from "@/components/ui/Footer";
import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import {
  PLANS,
  PLAN_ORDER,
  planPriceForPeriod,
  APPLE_DEVELOPER_PROGRAM_PRICE_USD,
  DONE_FOR_YOU_PUBLISHING_PRICE_USD,
  type BillingPeriod,
  type PlanId,
} from "@mobilio/config";

const FOUNDING_OFFER_ENABLED = process.env.NEXT_PUBLIC_FOUNDING_OFFER === "true";

const PLAN_CTA_HREF: Record<PlanId, string> = {
  preview: "/#start",
  testOnIphone: "/#start",
  launch: "/login",
  growth: "/login",
  agency: "/login",
};

export default function PricingPage() {
  const t = useTranslations("pricing");
  const tLanding = useTranslations("landing");
  const tHeader = useTranslations("header");
  const year = new Date().getFullYear();
  const [period, setPeriod] = useState<BillingPeriod>("monthly");

  return (
    <div className="flex flex-1 flex-col bg-mist text-ink">
      <PublicHeader
        nav={
          <>
            <Link href="/#how" className="text-slate">{tLanding("nav.how")}</Link>
            <Link href="/pricing" aria-current="page" className="text-ink">{tLanding("nav.pricing")}</Link>
            <Link href="/login" className="text-slate">{tHeader("signIn")}</Link>
          </>
        }
        actions={
          <>
            <LocaleSwitcher />
            <Link href="/" className="flex h-11 items-center rounded-pill bg-violet px-5 text-[15px] font-bold text-white">
              {tLanding("nav.startFree")}
            </Link>
          </>
        }
      />
      <main className="mx-auto flex w-full max-w-[1320px] flex-col gap-10 px-5 pb-20 pt-8 sm:px-8 lg:gap-14">
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="max-w-[820px] font-[family-name:var(--font-unbounded)] text-[34px] font-extrabold leading-[1.1] tracking-[-0.035em] sm:text-[44px] lg:text-[56px] lg:leading-[1.05]">
            {t("title")}
          </h1>
          <p className="max-w-[600px] text-base leading-relaxed text-slate lg:text-lg">{t("subtitle")}</p>
          <div role="radiogroup" aria-label={t("billingPeriodLabel")} className="flex gap-1 rounded-pill border-[1.5px] border-line bg-white p-1">
            <button
              type="button"
              role="radio"
              aria-checked={period === "monthly"}
              onClick={() => setPeriod("monthly")}
              className={["h-11 rounded-pill px-5 text-[15px] font-semibold", period === "monthly" ? "bg-ink text-white" : "text-slate"].join(" ")}
            >
              {t("monthly")}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={period === "yearly"}
              onClick={() => setPeriod("yearly")}
              className={["h-11 rounded-pill px-5 text-[15px] font-semibold", period === "yearly" ? "bg-ink text-white" : "text-slate"].join(" ")}
            >
              {t("yearly")}
            </button>
          </div>
        </div>

        {FOUNDING_OFFER_ENABLED ? (
          <div className="rounded-[22px] bg-lime px-5 py-4 text-[15px] leading-snug sm:px-6">
            <b>{t("foundingOfferLabel")}</b> {t("foundingOfferBody", { price: `$${planPriceForPeriod(PLANS.launch, "monthly")}` })}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {PLAN_ORDER.map((planId) => {
            const plan = PLANS[planId];
            const price = planPriceForPeriod(plan, period);
            const isOnce = plan.price.once !== null;
            const isDark = planId === "launch";
            return (
              <div
                key={planId}
                className={[
                  "relative flex flex-col gap-4 rounded-card p-6",
                  isDark ? "bg-ink text-white" : "bg-white",
                ].join(" ")}
              >
                {plan.mostPopular ? (
                  <span className="absolute -top-3 left-6 flex h-6 items-center rounded-pill bg-lime px-3 text-xs font-bold text-ink">
                    {t("mostPopular")}
                  </span>
                ) : null}
                <div className="flex flex-col gap-1.5">
                  <span className="text-lg font-bold">{t(`${planId}.name`)}</span>
                  <span className={["text-sm leading-snug", isDark ? "text-haze" : "text-slate"].join(" ")}>
                    {t(`${planId}.tagline`)}
                  </span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-[family-name:var(--font-unbounded)] text-4xl font-extrabold tracking-[-0.03em]">
                    ${price}
                  </span>
                  {!isOnce && price !== 0 ? (
                    <span className={isDark ? "text-haze" : "text-slate"}>
                      {period === "yearly" ? t("perYear") : t("perMonth")}
                    </span>
                  ) : isOnce && price !== 0 ? (
                    <span className={isDark ? "text-haze" : "text-slate"}>{t("once")}</span>
                  ) : null}
                </div>
                {!isOnce && price !== 0 ? (
                  <span className={["-mt-3 text-xs", isDark ? "text-haze" : "text-slate"].join(" ")}>
                    {period === "yearly" ? t("billedYearly") : t("billedMonthly")}
                  </span>
                ) : null}
                <Link
                  href={PLAN_CTA_HREF[planId]}
                  className={[
                    "flex h-12 items-center justify-center rounded-pill text-[15px] font-bold",
                    isDark ? "bg-lime text-ink" : planId === "preview" || planId === "agency" ? "border-[1.5px] border-line text-ink" : planId === "testOnIphone" ? "bg-violet text-white" : "bg-violet text-white",
                  ].join(" ")}
                >
                  {planId === "preview"
                    ? t("startFree")
                    : planId === "testOnIphone"
                      ? t("testMyApp")
                      : planId === "launch"
                        ? t("publishMyApp")
                        : planId === "growth"
                          ? t("chooseGrowth")
                          : t("chooseAgency")}
                </Link>
                <ul className="flex flex-1 flex-col gap-2.5 text-[15px] leading-tight">
                  {([1, 2, 3, 4] as const).map((n) =>
                    t.has(`${planId}.feature${n}`) ? <li key={n}>{t(`${planId}.feature${n}`)}</li> : null,
                  )}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col items-center justify-between gap-4 rounded-card bg-white p-6 sm:flex-row sm:p-7">
          <div className="flex max-w-[720px] flex-col gap-1">
            <span className="text-lg font-bold">
              {t("addOn.title", { price: `$${DONE_FOR_YOU_PUBLISHING_PRICE_USD}` })}
            </span>
            <span className="text-[15px] leading-relaxed text-slate">{t("addOn.body")}</span>
          </div>
          <a href="#contact" className="flex h-12 shrink-0 items-center rounded-pill border-[1.5px] border-line px-5 text-[15px] font-bold">
            {t("addOn.cta")}
          </a>
        </div>

        <p className="text-center text-sm leading-relaxed text-slate">
          {t("legalNote", { price: `$${APPLE_DEVELOPER_PROGRAM_PRICE_USD}` })}
        </p>

        <section className="mx-auto flex w-full max-w-[820px] flex-col gap-3">
          <h2 className="font-[family-name:var(--font-unbounded)] text-2xl font-bold tracking-[-0.02em]">{t("faq.title")}</h2>
          {([1, 2, 3, 4] as const).map((n) => (
            <details key={n} className="rounded-2xl bg-white p-5">
              <summary className="min-h-7 cursor-pointer text-base font-bold [&::-webkit-details-marker]:hidden">
                {t(`faq.q${n}`)}
              </summary>
              <p className="mt-2.5 text-[15px] leading-relaxed text-slate">{t(`faq.a${n}`)}</p>
            </details>
          ))}
        </section>
      </main>

      <Footer
        nav={
          <>
            <Link href="/legal/privacy">Privacy</Link>
            <Link href="/legal/terms">Terms</Link>
          </>
        }
        copyright={`© ${year} Mobilio`}
      />
    </div>
  );
}
