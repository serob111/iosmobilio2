"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { Logo } from "./Logo";

export interface AppHeaderOrg {
  id: string;
  name: string;
}

export interface AppHeaderNavItem {
  href: string;
  label: string;
  current?: boolean;
}

export interface AppHeaderProps {
  organizations: AppHeaderOrg[];
  currentOrgId: string;
  onOrgChange: (orgId: string) => void;
  nav: AppHeaderNavItem[];
  email: string;
  signOutLabel: string;
  onSignOut: () => void;
}

/** The signed-in app chrome from the Projects mock: org switcher, section nav, account menu. */
export function AppHeader({ organizations, currentOrgId, onOrgChange, nav, email, signOutLabel, onSignOut }: AppHeaderProps) {
  const t = useTranslations("appHeader");
  const [menuOpen, setMenuOpen] = useState(false);
  const initial = email.charAt(0).toUpperCase() || "?";

  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex w-full max-w-[1320px] flex-wrap items-center justify-between gap-3 px-5 py-3.5 sm:px-8">
        <div className="flex flex-wrap items-center gap-3 sm:gap-7">
          <Link href="/" aria-label={t("home")}>
            <Logo tone="ink" className="text-[19px]" />
          </Link>

          {organizations.length > 0 ? (
            <label className="sr-only" htmlFor="app-header-org">
              {t("organization")}
            </label>
          ) : null}
          {organizations.length > 0 ? (
            <select
              id="app-header-org"
              value={currentOrgId}
              onChange={(event) => onOrgChange(event.target.value)}
              className="h-10 max-w-full rounded-field-lg border-[1.5px] border-line bg-white px-3 text-sm font-semibold text-ink outline-none focus:border-2 focus:border-violet"
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          ) : null}

          <nav aria-label={t("main")} className="flex flex-wrap gap-1 text-[15px] font-semibold">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={item.current ? "page" : undefined}
                className={[
                  "flex h-10 items-center rounded-pill px-3.5",
                  item.current ? "bg-lilac text-ink" : "text-slate hover:text-ink",
                ].join(" ")}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="relative">
          <button
            type="button"
            aria-label={t("account")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-violet font-bold text-white"
          >
            {initial}
          </button>
          {menuOpen ? (
            <div role="menu" className="absolute right-0 top-[calc(100%+8px)] z-10 flex min-w-48 flex-col gap-2 rounded-2xl bg-white p-3 shadow-card-hover">
              <span className="truncate px-2 text-sm text-slate">{email}</span>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onSignOut();
                }}
                className="rounded-xl px-2 py-2 text-left text-sm font-semibold text-ink hover:bg-mist-soft"
              >
                {signOutLabel}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
