"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { fetchMe, listProjects, type MeResponse, type ProjectSummary } from "@/lib/apiClient";

const CURRENT_ORG_STORAGE_KEY = "mobilio.currentOrgId";

/** The current org is whichever one Header's own switcher last set — same localStorage key, so switching there is reflected here without any extra plumbing. */
export default function ProjectsPage() {
  const t = useTranslations("projects");
  const [me, setMe] = useState<MeResponse | null | "loading">("loading");
  const [orgId, setOrgId] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);

  useEffect(() => {
    fetchMe()
      .then((result) => {
        setMe(result);
        if (result && result.organizations.length > 0) {
          const stored = window.localStorage.getItem(CURRENT_ORG_STORAGE_KEY);
          const valid = result.organizations.some((org) => org.id === stored);
          setOrgId(valid && stored ? stored : result.organizations[0]!.id);
        }
      })
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (!orgId) return;
    listProjects(orgId)
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [orgId]);

  function handleOrgChange(nextOrgId: string) {
    setOrgId(nextOrgId);
    window.localStorage.setItem(CURRENT_ORG_STORAGE_KEY, nextOrgId);
  }

  if (me === "loading" || me === null) {
    return null;
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-6 bg-zinc-50 px-4 py-12">
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{t("title")}</h1>
          {me.organizations.length > 1 ? (
            <select
              value={orgId}
              onChange={(e) => handleOrgChange(e.target.value)}
              aria-label={t("organization")}
              className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-sm text-[#17112E]"
            >
              {me.organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        {projects === null ? null : projects.length === 0 ? (
          <p className="mt-6 text-sm text-zinc-500">{t("empty")}</p>
        ) : (
          <ul className="mt-6 flex flex-col gap-2">
            {projects.map((project) => (
              <li key={project.id} className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4">
                <span className="text-sm font-medium text-zinc-900">{project.name}</span>
                <Link href={`/projects/${orgId}/${project.id}`} className="text-sm font-medium text-[#4B2BE0] underline">
                  {t("openProject")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
