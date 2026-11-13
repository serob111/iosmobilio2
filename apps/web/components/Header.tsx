"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/authClient";
import { fetchMe, type MeResponse } from "@/lib/apiClient";

const CURRENT_ORG_STORAGE_KEY = "mobilio.currentOrgId";

export default function Header() {
  const t = useTranslations("header");
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null | "loading">("loading");
  const [currentOrgId, setCurrentOrgId] = useState<string>("");

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

  async function handleLogout() {
    await authClient.signOut();
    setMe(null);
    router.push("/");
    router.refresh();
  }

  return (
    <header className="flex items-center justify-between gap-4 border-b border-zinc-200 bg-white px-6 py-3">
      <Link
        href="/"
        className="font-[family-name:var(--font-unbounded)] text-lg font-extrabold tracking-tight text-[#17112E]"
      >
        mobilio
      </Link>

      {me === "loading" ? null : me === null ? (
        <Link
          href="/login"
          className="rounded-full bg-[#17112E] px-5 py-2 text-sm font-semibold text-white hover:opacity-85"
        >
          {t("signIn")}
        </Link>
      ) : (
        <div className="flex items-center gap-3">
          <Link href="/projects" className="text-sm font-medium text-[#17112E] hover:underline">
            {t("projects")}
          </Link>
          {me.organizations.length > 0 ? (
            <select
              value={currentOrgId}
              onChange={(event) => handleOrgChange(event.target.value)}
              aria-label="organization"
              className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-sm text-[#17112E] outline-none focus:border-[#4B2BE0]"
            >
              {me.organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          ) : null}
          <span className="text-sm text-zinc-600">{me.user.email}</span>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm font-semibold text-[#17112E] hover:bg-zinc-50"
          >
            {t("signOut")}
          </button>
        </div>
      )}
    </header>
  );
}
