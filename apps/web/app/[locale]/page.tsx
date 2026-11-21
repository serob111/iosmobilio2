"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Footer } from "@/components/ui/Footer";
import { SiteUrlForm } from "@/components/landing/SiteUrlForm";
import { HeroPhonesDesktop, HeroPhonesMobile } from "@/components/landing/HeroPhones";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { PLANS, planPriceForPeriod, APPLE_DEVELOPER_PROGRAM_PRICE_USD } from "@mobilio/config";

function IconPush() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#17112E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}
function IconReview() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#17112E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </svg>
  );
}
function IconNoMac() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#17112E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8" />
      <path d="M4 4l16 12" />
    </svg>
  );
}
function IconSync() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#17112E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12a8 8 0 0 1 14-5.3L20 9" />
      <path d="M20 4v5h-5" />
      <path d="M20 12a8 8 0 0 1-14 5.3L4 15" />
      <path d="M4 20v-5h5" />
    </svg>
  );
}
function IconNative() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#17112E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="2.5" width="12" height="19" rx="3" />
      <path d="M9 17h6" />
    </svg>
  );
}
function IconLanguages() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#17112E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.5 3.5 6 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-6-3.5-9s1-6.5 3.5-9z" />
    </svg>
  );
}
function IconCheck() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#D7FF4F" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

const FEATURES = [
  { Icon: IconPush, titleKey: "pushTitle", bodyKey: "pushBody" },
  { Icon: IconReview, titleKey: "reviewTitle", bodyKey: "reviewBody" },
  { Icon: IconNoMac, titleKey: "noMacTitle", bodyKey: "noMacBody" },
  { Icon: IconSync, titleKey: "syncTitle", bodyKey: "syncBody" },
  { Icon: IconNative, titleKey: "nativeTitle", bodyKey: "nativeBody" },
  { Icon: IconLanguages, titleKey: "languagesTitle", bodyKey: "languagesBody" },
] as const;

export default function LandingPage() {
  const t = useTranslations("landing");
  const tPricing = useTranslations("pricing");
  const year = new Date().getFullYear();
  const testOnIphonePrice = planPriceForPeriod(PLANS.testOnIphone, "monthly");
  const launchPrice = planPriceForPeriod(PLANS.launch, "monthly");

  return (
    <div className="flex flex-1 flex-col bg-white text-ink">
      {/* Hero */}
      <section id="top" className="relative overflow-hidden bg-violet text-white">
        <div aria-hidden="true" className="pointer-events-none absolute -left-32 -top-40 h-[420px] w-[420px] rounded-full bg-white/[0.07]" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 top-56 h-[480px] w-[480px] rounded-full bg-ink/20" />
        <LandingHeader
          nav={
            <>
              <a href="#how" className="hidden text-white sm:inline">{t("nav.how")}</a>
              <a href="#features" className="hidden text-white sm:inline">{t("nav.features")}</a>
              <Link href="/pricing" className="hidden text-white sm:inline">{t("nav.pricing")}</Link>
              <a href="#faq" className="hidden text-white sm:inline">{t("nav.faq")}</a>
            </>
          }
          startFreeLabel={t("nav.startFree")}
        />

        <div className="relative mx-auto flex max-w-[1000px] flex-col items-center gap-5 px-5 pb-16 pt-4 text-center sm:px-8 lg:pb-0">
          <h1 className="font-[family-name:var(--font-unbounded)] text-[34px] font-extrabold leading-[1.08] tracking-[-0.03em] lg:text-[64px] lg:leading-[1.05]">
            <span className="block">{t("hero.titleLine1")}</span>
            <span className="block">{t("hero.titleLine2")}</span>
          </h1>
          <p className="max-w-[560px] text-base leading-relaxed text-lilac lg:text-[19px]">{t("hero.subtitle")}</p>
          <div className="w-full sm:w-auto">
            <SiteUrlForm id="start" variant="hero" />
          </div>
        </div>

        <HeroPhonesDesktop pushLabel={t("hero.badgePush")} noMacLabel={t("hero.badgeNoMac")} />
        <div className="relative px-5 pb-10 sm:px-8">
          <HeroPhonesMobile pushLabel={t("hero.badgePush")} noMacLabel={t("hero.badgeNoMac")} />
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto flex w-full max-w-[1240px] flex-col gap-10 px-5 py-16 sm:px-8 lg:gap-14 lg:py-24">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
          <h2 className="max-w-[640px] font-[family-name:var(--font-unbounded)] text-[28px] font-extrabold leading-[1.1] tracking-[-0.03em] lg:text-[48px] lg:leading-[1.08]">
            {t("howItWorks.title")} <span className="text-violet">{t("howItWorks.titleHighlight")}</span>
          </h2>
          <p className="max-w-[380px] text-base leading-relaxed text-slate lg:text-lg">{t("howItWorks.subtitle")}</p>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {([1, 2, 3] as const).map((n) => (
            <div
              key={n}
              className={[
                "flex flex-col gap-3 rounded-card p-6 lg:gap-4 lg:p-8",
                n === 3 ? "bg-ink text-white" : "bg-mist",
              ].join(" ")}
            >
              <span
                className={[
                  "flex h-11 w-11 items-center justify-center rounded-2xl font-[family-name:var(--font-unbounded)] text-lg font-extrabold lg:h-14 lg:w-14 lg:text-xl",
                  n === 3 ? "bg-lime text-ink" : "bg-violet text-white",
                ].join(" ")}
              >
                {n}
              </span>
              <h3 className="font-[family-name:var(--font-unbounded)] text-lg font-bold tracking-[-0.02em] lg:text-[22px]">
                {t(`howItWorks.step${n}Title`)}
              </h3>
              <p className={["text-base leading-relaxed lg:text-[17px]", n === 3 ? "text-haze" : "text-slate"].join(" ")}>
                {t(`howItWorks.step${n}Body`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="bg-mist">
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-10 px-5 py-16 sm:px-8 lg:gap-14 lg:py-24">
          <h2 className="max-w-[760px] font-[family-name:var(--font-unbounded)] text-[28px] font-extrabold leading-[1.1] tracking-[-0.03em] lg:text-[48px] lg:leading-[1.08]">
            {t("features.title")}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ Icon, titleKey, bodyKey }) => (
              <div key={titleKey} className="flex gap-4 rounded-2xl bg-white p-5 lg:flex-col lg:gap-3.5 lg:p-7">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-lime lg:h-12 lg:w-12">
                  <Icon />
                </span>
                <div className="flex flex-col gap-1">
                  <h3 className="text-lg font-bold lg:text-[21px]">{t(`features.${titleKey}`)}</h3>
                  <p className="text-[15px] leading-relaxed text-slate lg:text-base">{t(`features.${bodyKey}`)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* For online stores */}
      <section id="stores" className="bg-ink text-white">
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-5 py-16 sm:px-8 lg:flex-row lg:items-center lg:gap-[72px] lg:py-24">
          <div className="flex flex-col gap-4 lg:flex-1 lg:gap-5">
            <span className="self-start rounded-pill bg-lime px-3.5 py-1.5 text-sm font-bold text-ink">{t("stores.badge")}</span>
            <h2 className="font-[family-name:var(--font-unbounded)] text-[28px] font-extrabold leading-[1.1] tracking-[-0.03em] lg:text-[48px] lg:leading-[1.08]">
              {t("stores.title")}
            </h2>
            <p className="text-base leading-relaxed text-haze lg:text-lg">{t("stores.subtitle")}</p>
            <div className="flex flex-col gap-3 text-base lg:text-[17px]">
              {([1, 2, 3, 4] as const).map((n) => (
                <span key={n} className="flex items-center gap-2.5">
                  <IconCheck />
                  {t(`stores.bullet${n}`)}
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2.5 lg:flex-1">
            <div className="flex gap-3 rounded-[18px] border border-night-line bg-night px-4 py-3.5 lg:rounded-[22px] lg:px-5 lg:py-4.5">
              <span className="flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-xl bg-white font-extrabold text-violet lg:h-11 lg:w-11">L</span>
              <span className="text-[15px] lg:text-[17px]">{t("stores.message1")}</span>
            </div>
            <div className="ml-3.5 flex gap-3 rounded-[18px] border border-night-line bg-night px-4 py-3.5 lg:ml-10 lg:rounded-[22px] lg:px-5 lg:py-4.5">
              <span className="flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-xl bg-white font-extrabold text-violet lg:h-11 lg:w-11">L</span>
              <span className="text-[15px] lg:text-[17px]">{t("stores.message2")}</span>
            </div>
            <div className="ml-7 flex gap-3 rounded-[18px] bg-lime px-4 py-3.5 text-ink lg:ml-20 lg:rounded-[22px] lg:px-5 lg:py-4.5">
              <span className="flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-xl bg-ink font-extrabold text-lime lg:h-11 lg:w-11">L</span>
              <span className="text-[15px] font-semibold lg:text-[17px]">{t("stores.message3")}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing teaser */}
      <section id="pricing" className="mx-auto flex w-full max-w-[1240px] flex-col gap-8 px-5 py-16 sm:px-8 lg:gap-14 lg:py-24">
        <div className="flex flex-col items-center gap-3 text-center">
          <h2 className="font-[family-name:var(--font-unbounded)] text-[28px] font-extrabold leading-[1.1] tracking-[-0.03em] lg:text-[48px] lg:leading-[1.08]">
            {t("pricingTeaser.title")}
          </h2>
          <p className="text-base text-slate lg:text-lg">{t("pricingTeaser.subtitle")}</p>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div className="flex flex-col gap-5 rounded-card border-[1.5px] border-line p-7 lg:p-9">
            <h3 className="text-xl font-bold">{tPricing("preview.name")}</h3>
            <span className="font-[family-name:var(--font-unbounded)] text-4xl font-extrabold tracking-[-0.03em] lg:text-[48px]">$0</span>
            <p className="text-base leading-relaxed text-slate">{t("pricingTeaser.previewTagline")}</p>
            <div className="flex flex-1 flex-col gap-3 text-base">
              <span>{t("pricingTeaser.previewFeature1")}</span>
              <span>{t("pricingTeaser.previewFeature2")}</span>
              <span>{t("pricingTeaser.previewFeature3")}</span>
            </div>
            <a href="#start" className="flex h-[52px] items-center justify-center rounded-pill border-[1.5px] border-ink text-base font-bold">
              {t("pricingTeaser.previewCta")}
            </a>
          </div>

          <div className="flex flex-col gap-5 rounded-card bg-violet p-7 text-white lg:p-9">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xl font-bold">{tPricing("testOnIphone.name")}</h3>
              <span className="rounded-pill bg-lime px-3 py-1.5 text-xs font-bold text-ink">{t("pricingTeaser.testOnIphoneBadge")}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-[family-name:var(--font-unbounded)] text-4xl font-extrabold tracking-[-0.03em] lg:text-[48px]">
                ${testOnIphonePrice}
              </span>
              <span className="text-lilac">{t("pricingTeaser.testOnIphoneUnit")}</span>
            </div>
            <p className="text-base leading-relaxed text-lilac">{t("pricingTeaser.testOnIphoneTagline")}</p>
            <div className="flex flex-1 flex-col gap-3 text-base">
              <span>{t("pricingTeaser.testOnIphoneFeature1")}</span>
              <span>{t("pricingTeaser.testOnIphoneFeature2")}</span>
              <span>{t("pricingTeaser.testOnIphoneFeature3")}</span>
            </div>
            <a href="#start" className="flex h-[52px] items-center justify-center rounded-pill bg-lime text-base font-bold text-ink">
              {t("pricingTeaser.testOnIphoneCta")}
            </a>
          </div>

          <div className="flex flex-col gap-5 rounded-card border-[1.5px] border-line p-7 lg:p-9">
            <h3 className="text-xl font-bold">{tPricing("launch.name")}</h3>
            <div className="flex items-baseline gap-2">
              <span className="font-[family-name:var(--font-unbounded)] text-4xl font-extrabold tracking-[-0.03em] lg:text-[48px]">
                ${launchPrice}
              </span>
              <span className="text-slate">{t("pricingTeaser.launchUnit")}</span>
            </div>
            <p className="text-base leading-relaxed text-slate">{t("pricingTeaser.launchTagline")}</p>
            <div className="flex flex-1 flex-col gap-3 text-base">
              <span>{t("pricingTeaser.launchFeature1")}</span>
              <span>{t("pricingTeaser.launchFeature2")}</span>
              <span>{t("pricingTeaser.launchFeature3")}</span>
            </div>
            <Link href="/pricing" className="flex h-[52px] items-center justify-center rounded-pill bg-ink text-base font-bold text-white">
              {t("pricingTeaser.launchCta")}
            </Link>
          </div>
        </div>
        <p className="text-center text-sm text-slate">
          {t("pricingTeaser.disclaimer", { price: `$${APPLE_DEVELOPER_PROGRAM_PRICE_USD}` })}
        </p>
      </section>

      {/* FAQ */}
      <section id="faq" className="bg-mist">
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6 px-5 py-16 sm:px-8 lg:py-24">
          <h2 className="font-[family-name:var(--font-unbounded)] text-[28px] font-extrabold leading-[1.1] tracking-[-0.03em] lg:text-[48px] lg:leading-[1.08]">
            {t("faq.title")}
          </h2>
          <div className="flex flex-col gap-3">
            {([1, 2, 3, 4] as const).map((n) => (
              <details key={n} className="rounded-2xl bg-white p-5 lg:p-6.5">
                <summary className="flex min-h-7 cursor-pointer items-center justify-between gap-4 text-base font-semibold [&::-webkit-details-marker]:hidden">
                  {t(`faq.q${n}`)}
                  <span aria-hidden="true" className="text-2xl text-violet">+</span>
                </summary>
                <p className="mt-2.5 text-[15px] leading-relaxed text-slate lg:text-base">{t(`faq.a${n}`)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto w-full max-w-[1240px] px-5 py-14 sm:px-8 lg:py-24">
        <div className="relative overflow-hidden rounded-[30px] bg-violet px-6 py-10 text-center text-white sm:px-10 lg:rounded-[40px] lg:px-12 lg:py-[72px]">
          <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-[220px] w-[220px] rounded-full bg-white/[0.08] lg:-right-24 lg:-top-32 lg:h-[360px] lg:w-[360px]" />
          <div className="relative flex flex-col items-center gap-4">
            <h2 className="font-[family-name:var(--font-unbounded)] text-[26px] font-extrabold leading-[1.1] tracking-[-0.03em] lg:text-[48px] lg:leading-[1.08]">
              {t("finalCta.title")}
            </h2>
            <p className="text-sm text-lilac lg:text-lg">{t("finalCta.subtitle")}</p>
            <div className="w-full sm:w-auto sm:min-w-[540px]">
              <SiteUrlForm variant="cta" />
            </div>
          </div>
        </div>
      </section>

      <Footer
        nav={
          <>
            <Link href="/legal/privacy">{t("footer.privacy")}</Link>
            <Link href="/legal/terms">{t("footer.terms")}</Link>
            <a href="#top">{t("footer.contact")}</a>
          </>
        }
        copyright={t("footer.copyright", { year })}
      />
    </div>
  );
}
