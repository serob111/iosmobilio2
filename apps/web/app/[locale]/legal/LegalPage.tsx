import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/ui/Logo";
import { englishLegal } from "./content/en";
import { russianLegal } from "./content/ru";
import type { LegalConfig, LegalDocumentId } from "./content/types";

const IDS: LegalDocumentId[] = ["terms", "privacy", "refunds"];

export function legalConfig(): LegalConfig {
  return {
    company: process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME ?? "Mobilio",
    address: process.env.NEXT_PUBLIC_COMPANY_ADDRESS ?? "Yerevan, Armenia",
    email: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@mobilio.am",
  };
}

export function LegalPage({ locale, documentId }: { locale: string; documentId: LegalDocumentId }) {
  const bundle = locale === "ru" ? russianLegal(legalConfig()) : englishLegal(legalConfig());
  const document = bundle.documents[documentId];
  return <div className="min-h-screen bg-white text-ink">
    <header className="border-b border-line"><div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 px-4 py-[22px] sm:px-8"><Link href="/" aria-label="Mobilio"><Logo /></Link><nav aria-label={bundle.mainNav} className="flex gap-[22px] text-[15px] font-semibold text-slate"><Link href="/pricing">{bundle.pricing}</Link><Link href="/login">{bundle.signIn}</Link></nav></div></header>
    <div className="mx-auto flex max-w-[1240px] flex-wrap items-start gap-12 px-4 pb-20 pt-12 sm:px-8">
      <nav aria-label={bundle.legalNav} className="flex min-w-0 flex-[1_1_220px] flex-col gap-1 text-[15px] font-semibold">{IDS.map(id => <Link key={id} href={`/legal/${id}`} aria-current={id === documentId ? "page" : undefined} className={`flex min-h-11 items-center rounded-xl px-3.5 ${id === documentId ? "bg-mist text-ink" : "text-slate"}`}>{bundle.documents[id].title}</Link>)}</nav>
      <article className="flex min-w-0 max-w-[760px] flex-[999_1_560px] flex-col gap-7 text-[17px] leading-[1.65]">
        <div className="flex flex-col gap-2.5"><h1 className="font-[family-name:var(--font-unbounded)] text-[clamp(32px,4vw,44px)] font-extrabold leading-[1.1] tracking-[-.03em]">{document.title}</h1><p className="text-[15px] text-slate">{locale === "ru" ? `Действует с ${document.effective} · Обновлено ${document.updated}` : `Effective ${document.effective} · Last updated ${document.updated}`}</p></div>
        <aside className="flex flex-col gap-2 rounded-[20px] bg-mist px-[22px] py-5 text-base leading-[1.55]"><strong>{document.summaryTitle}</strong><span>{document.summary}</span></aside>
        {document.sections.map(section => <section key={section.title} className="flex flex-col gap-2.5"><h2 className="text-[22px] font-bold">{section.title}</h2>{section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</section>)}
        <a href={`mailto:${legalConfig().email}`} className="font-semibold text-violet underline">{legalConfig().email}</a>
      </article>
    </div>
  </div>;
}
