"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/authClient";
import { fetchMe, type MeResponse } from "@/lib/apiClient";
import { PublicHeader } from "@/components/ui/PublicHeader";
import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";

const CURRENT_ORG_STORAGE_KEY = "mobilio.currentOrgId";

/**
 * The landing page's header has two identities sharing one slot: signed-out visitors see
 * the marketing nav (How it works/Features/Pricing/FAQ, Log in, Start free) from the
 * Vivid mock; a signed-in user instead sees the account bar (email, org switcher, sign
 * out) the rest of the app already uses — this is what auth.spec.ts's `header select
 * option` / "Sign out" / "Sign in" assertions on "/" depend on, so it can't just
 * disappear behind the redesign.
 */
export function LandingHeader({ nav, startFreeLabel }: { nav: ReactNode; startFreeLabel: string }) {
  const tHeader = useTranslations("header");
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null | "loading">("loading");
  const [currentOrgId, setCurrentOrgId] = useState("");

  useEffect(() => {
    fetchMe()
      .then((result) => {
        setMe(result);
        if (result && result.organizations.length > 0) {
          const stored = window.localStorage.getItem(CURRENT_ORG_STORAGE_KEY);
          const valid = result.organizations.some((org) => org.id === stored);
          setCurrentOrgId(valid && stored ? stored : result.organizations[0]!.id);
        }
      })
      .catch(() => setMe(null));
  }, []);

  function handleOrgChange(orgId: string) {
    setCurrentOrgId(orgId);
    window.localStorage.setItem(CURRENT_ORG_STORAGE_KEY, orgId);
  }

  async function handleSignOut() {
    await authClient.signOut();
    setMe(null);
    router.push("/");
    router.refresh();
  }

  return (
    <PublicHeader
      tone="onDark"
      nav={nav}
      actions={
        me === "loading" ? null : me === null ? (
          <>
            <LocaleSwitcher tone="onDark" />
            <Link href="/login" className="hidden h-11 items-center px-3.5 text-[15px] font-medium text-white sm:flex">
              {tHeader("signIn")}
            </Link>
            <a href="#start" className="flex h-11 items-center rounded-pill bg-lime px-5 text-[15px] font-bold text-ink">
              {startFreeLabel}
            </a>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-2.5">
            <LocaleSwitcher tone="onDark" />
            {me.organizations.length > 0 ? (
              <select
                value={currentOrgId}
                onChange={(event) => handleOrgChange(event.target.value)}
                aria-label="organization"
                className="h-10 rounded-pill border border-white/35 bg-transparent px-3 text-sm text-white outline-none [&>option]:text-ink"
              >
                {me.organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            ) : null}
            <Link href="/projects" className="hidden text-[15px] font-semibold text-white sm:inline">
              {tHeader("projects")}
            </Link>
            <span className="hidden text-sm text-lilac sm:inline">{me.user.email}</span>
            <button
              type="button"
              onClick={handleSignOut}
              className="h-10 rounded-pill border border-white/35 px-4 text-sm font-semibold text-white hover:bg-white/10"
            >
              {tHeader("signOut")}
            </button>
          </div>
        )
      }
    />
  );
}
