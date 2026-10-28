"use client";

import { useState } from "react";
import type { PreviewDto } from "@/lib/apiClient";
import { TabIcon } from "./TabIcon";

const ABUSE_EMAIL = process.env.NEXT_PUBLIC_ABUSE_EMAIL ?? "abuse@mobilio.app";

type Props = {
  dto: PreviewDto;
};

/**
 * The "app" itself: a status bar, the active tab's content proxied through
 * PREVIEW_PROXY_ORIGIN inside a sandboxed iframe, and a bottom tab bar. One tree, not two
 * — an iPhone-shaped frame is layered on at the md: breakpoint via responsive classes on
 * the same elements, rather than rendering a whole separate desktop/mobile subtree (which
 * would mean two live iframes loading the same content at once, and two of everything for
 * any test locator to disambiguate).
 *
 * sandbox deliberately omits allow-forms and allow-top-navigation: the proxied site can
 * run its own scripts and treat itself as same-origin (both needed for it to function at
 * all), and can open popups (its own "open in new tab" links), but can never submit a
 * form back to anywhere or navigate the parent frame away from this preview.
 */
export function PreviewShell({ dto }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeTab = dto.tabs[activeIndex];
  const isDark = dto.statusBar === "dark";

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="w-full md:w-auto md:rounded-[48px] md:border-[10px] md:border-[#17112E] md:bg-[#17112E] md:p-2 md:shadow-xl">
        <div className="flex h-[100vh] w-full flex-col overflow-hidden bg-white pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:h-[760px] md:w-[360px] md:rounded-[38px] md:pt-0 md:pb-0">
          <div
            className="flex items-center justify-center gap-2 py-2 text-xs font-medium"
            style={{ background: dto.theme.background, color: isDark ? "#111" : "#fff" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- remote signed URL, not a static asset */}
            <img src={dto.iconUrl} alt="" className="h-4 w-4 rounded-sm" />
            {dto.name}
          </div>

          <div className="flex-1 overflow-hidden bg-white">
            {activeTab?.path ? (
              <iframe
                key={activeTab.path}
                src={`${dto.proxyBase}${activeTab.path}`}
                title={activeTab.title}
                className="h-full w-full border-0"
                sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-zinc-500">
                Этот экран недоступен в превью
              </div>
            )}
          </div>

          <div className="flex border-t border-zinc-200 bg-white pb-[max(env(safe-area-inset-bottom),8px)] pt-2">
            {dto.tabs.map((tab, index) => {
              const active = index === activeIndex;
              const color = active ? dto.theme.primary : "#9CA3AF";
              return (
                <button
                  key={`${tab.title}-${index}`}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  className="flex flex-1 flex-col items-center gap-1"
                >
                  <TabIcon icon={tab.icon} color={color} />
                  <span className="text-[11px]" style={{ color }}>
                    {tab.title}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <p className="max-w-sm text-center text-xs text-zinc-500">
        Превью — так ваш сайт будет выглядеть в приложении.{" "}
        <a href={`mailto:${ABUSE_EMAIL}`} className="underline hover:text-zinc-700">
          Сообщить о нарушении
        </a>
      </p>
    </div>
  );
}
