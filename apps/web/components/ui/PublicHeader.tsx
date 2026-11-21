import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { Logo } from "./Logo";

export interface PublicHeaderProps {
  /** "onDark" sits transparently over a colored hero (Landing); "light" is the plain header used on Pricing/Terms. */
  tone?: "onDark" | "light";
  nav?: ReactNode;
  actions?: ReactNode;
}

/** Shared shell for marketing-page headers — logo, nav slot, actions slot. Pages supply their own links so each can use the right i18n Link/anchor for its content. */
export function PublicHeader({ tone = "light", nav, actions }: PublicHeaderProps) {
  return (
    <header
      className={[
        "relative mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-4 px-5 py-6 sm:px-8",
        tone === "onDark" ? "text-white" : "text-ink",
      ].join(" ")}
    >
      <Link href="/" aria-label="Mobilio home">
        <Logo tone={tone === "onDark" ? "white" : "ink"} />
      </Link>
      {nav ? <nav aria-label="Main" className="flex flex-wrap items-center gap-5 text-[15px] font-semibold">{nav}</nav> : null}
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
