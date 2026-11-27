import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/ui/Logo";

export default async function PreviewNotFound() {
  const t = await getTranslations("previewExpired");
  return <main className="mx-auto flex min-h-[844px] w-full max-w-[390px] flex-1 flex-col bg-mist px-6 pb-8 pt-7 text-ink">
    <Logo className="self-center text-[17px]" />
    <div className="flex flex-1 flex-col items-center justify-center gap-4.5 text-center">
      <span aria-hidden="true" className="flex h-24 w-24 items-center justify-center rounded-[28px] bg-lilac text-violet"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1M4 4l16 16"/></svg></span>
      <h1 className="font-[family-name:var(--font-unbounded)] text-[26px] font-extrabold leading-[1.15] tracking-[-.03em]">{t("title")}</h1>
      <p className="text-base leading-[1.55] text-slate">{t("body")}</p>
    </div>
    <div className="flex flex-col gap-3"><Link href="/" className="flex h-[54px] items-center justify-center rounded-pill bg-violet px-4 text-center font-bold text-white">{t("createCta")}</Link><p className="text-center text-[13px] leading-6 text-slate">{t("ownerPrompt")} <Link href="/login" className="font-semibold text-violet underline">{t("signIn")}</Link> {t("ownerSuffix")}</p></div>
  </main>;
}
