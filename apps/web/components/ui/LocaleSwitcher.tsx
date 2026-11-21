"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";

const OTHER_LOCALE: Record<string, "en" | "ru"> = { en: "ru", ru: "en" };
const LABEL: Record<string, string> = { en: "EN", ru: "RU" };
const SWITCH_TO_LABEL: Record<string, string> = {
  en: "Switch to Russian",
  ru: "Switch to English",
};

export interface LocaleSwitcherProps {
  tone?: "onDark" | "light";
}

/** The "EN" pill from the landing header — toggles between the two supported locales on the current page. */
export function LocaleSwitcher({ tone = "light" }: LocaleSwitcherProps) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const next = OTHER_LOCALE[locale] ?? "en";

  return (
    <button
      type="button"
      aria-label={SWITCH_TO_LABEL[locale] ?? "Switch language"}
      onClick={() => router.replace(pathname, { locale: next })}
      className={[
        "h-11 rounded-pill px-3.5 text-sm font-semibold transition-colors",
        tone === "onDark"
          ? "border border-white/35 text-white hover:bg-white/10"
          : "border-[1.5px] border-line text-ink hover:bg-mist-soft",
      ].join(" ")}
    >
      {LABEL[locale] ?? locale.toUpperCase()}
    </button>
  );
}
