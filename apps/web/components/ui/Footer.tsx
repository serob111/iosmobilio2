import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { Logo } from "./Logo";

export interface FooterProps {
  nav?: ReactNode;
  copyright: string;
}

/** The dark footer from the landing page — logo, footer nav slot, copyright. */
export function Footer({ nav, copyright }: FooterProps) {
  return (
    <footer className="bg-ink text-haze">
      <div className="mx-auto flex w-full max-w-[1240px] flex-col items-start gap-4 px-5 py-9 text-[15px] sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <Link href="/" aria-label="Mobilio home">
          <Logo tone="white" />
        </Link>
        {nav ? <nav aria-label="Footer" className="flex flex-wrap gap-6">{nav}</nav> : null}
        <span>{copyright}</span>
      </div>
    </footer>
  );
}
