import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/ui/Logo";

export default async function NotFoundPage() {
  const t = await getTranslations("notFound");
  return <div className="relative flex min-h-screen flex-1 flex-col overflow-hidden bg-ink text-white">
    <div aria-hidden="true" className="absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-violet opacity-55" />
    <header className="relative px-4 py-7 sm:px-10 lg:px-20"><Link href="/" aria-label={t("homeLabel")}><Logo tone="white" /></Link></header>
    <main className="relative flex flex-1 flex-wrap items-center gap-12 px-4 pb-16 pt-6 sm:px-10 lg:px-20">
      <div className="flex min-w-0 flex-[999_1_420px] flex-col gap-[22px]">
        <span aria-hidden="true" className="font-[family-name:var(--font-unbounded)] text-[clamp(96px,16vw,200px)] font-extrabold leading-[.9] tracking-[-.05em] text-lime">404</span>
        <h1 className="max-w-[760px] font-[family-name:var(--font-unbounded)] text-[clamp(28px,4vw,40px)] font-extrabold leading-[1.1] tracking-[-.03em]">{t("title")}</h1>
        <p className="max-w-[520px] text-[17px] leading-[1.55] text-haze">{t("body")}</p>
        <div className="flex flex-wrap gap-3"><Link href="/projects" className="flex h-[52px] items-center rounded-pill bg-lime px-[26px] font-bold text-ink">{t("projectsCta")}</Link><Link href="/" className="flex h-[52px] items-center rounded-pill border-[1.5px] border-[#3A3160] px-6 font-semibold text-white">{t("homeCta")}</Link></div>
      </div>
      <div aria-hidden="true" className="flex flex-[1_1_260px] justify-center"><div className="h-[450px] w-[220px] rotate-[8deg] rounded-[46px] bg-[linear-gradient(150deg,#9A8AA8,#4B4056_40%,#7D6E8B)] p-1 shadow-[0_40px_90px_rgba(0,0,0,.5)]"><div className="flex h-full w-full flex-col items-center justify-center gap-3.5 rounded-[42px] border-[7px] border-[#050505] bg-[#261E44]"><svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#CFC8E6" strokeWidth="1.6" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8.5 9.5l5 3M13.5 9.5l-5 3"/></svg><span className="text-[13px] text-haze">{t("phoneLabel")}</span></div></div></div>
    </main>
  </div>;
}
