"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { fetchMe, listProjects, listBuilds, createProject, createDraft, type MeResponse, type ProjectSummary, type BuildSummary } from "@/lib/apiClient";
import { authClient } from "@/lib/authClient";
import { useApiErrorMessage } from "@/lib/errorCodes";
import { AppHeader } from "@/components/ui/AppHeader";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { StatusBadge, type Status } from "@/components/ui/StatusBadge";

const STORAGE_KEY = "mobilio.currentOrgId";
type App = ProjectSummary & { build: BuildSummary | null; statusUnavailable: boolean };
function statusOf(app: App): Status { return app.build?.status === "done" ? "ready" : app.build?.status === "queued" ? "building" : app.build?.status ?? "draft"; }
function domain(url: string) { try { return new URL(url).hostname; } catch { return url; } }

export default function ProjectsPage() {
  const t = useTranslations("projects");
  const h = useTranslations("header");
  const locale = useLocale();
  const router = useRouter();
  const errorMessage = useApiErrorMessage();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [orgId, setOrgId] = useState("");
  const [apps, setApps] = useState<App[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const [url, setUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetchMe().then(result => {
      if (!active) return;
      if (!result) { router.replace("/login?callbackUrl=%2Fprojects"); return; }
      setMe(result);
      const stored = localStorage.getItem(STORAGE_KEY);
      setOrgId(result.organizations.find(o => o.id === stored)?.id ?? result.organizations[0]?.id ?? "");
      if (!result.organizations.length) setApps([]);
    }).catch(() => { if (active) setError("loadListError"); });
    return () => { active = false; };
  }, [router, retry]);
  useEffect(() => {
    if (!orgId) return;
    let active = true;
    listProjects(orgId).then(async projects => Promise.all(projects.map(async project => {
      try {
        const builds = await listBuilds(orgId, project.id);
        const build = [...builds].sort((a,b) => Date.parse(b.createdAt)-Date.parse(a.createdAt))[0] ?? null;
        return { ...project, build, statusUnavailable: false };
      } catch { return { ...project, build: null, statusUnavailable: true }; }
    }))).then(result => { if (active) setApps(result); }).catch(() => { if (active) setError("loadListError"); });
    return () => { active = false; };
  }, [orgId, retry]);
  function changeOrg(id: string) { setApps(null); setError(null); setOrgId(id); localStorage.setItem(STORAGE_KEY,id); }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim() || creating) return;
    setCreating(true); setCreateError(null);
    try {
      if (orgId) { const project = await createProject(orgId,url.trim()); router.push(`/projects/${orgId}/${project.id}`); }
      else { await createDraft(url.trim()); router.push("/try"); }
    } catch (err) { setCreateError(errorMessage(err)); setCreating(false); }
  }
  return <div className="min-h-screen flex-1 bg-mist text-ink">
    {me ? <AppHeader organizations={me.organizations} currentOrgId={orgId} onOrgChange={changeOrg} nav={[{ href: "/projects", label: t("title"), current: true }]} email={me.user.email} signOutLabel={h("signOut")} onSignOut={async () => { await authClient.signOut(); router.push("/"); router.refresh(); }} /> : null}
    <main className="mx-auto flex w-full max-w-[1320px] flex-col gap-7 px-4 pb-16 pt-9 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5"><h1 className="font-[family-name:var(--font-unbounded)] text-[32px] font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">{t("title")}</h1>
        {me ? <p className="text-[15px] text-slate">{t("count", { count: apps?.length ?? 0, workspace: me.organizations.find(o => o.id === orgId)?.name ?? me.user.name })}</p> : null}</div>
        {me ? <Button onClick={() => setShowNew(v => !v)} aria-expanded={showNew} aria-controls="new-app">+ {t("newApp")}</Button> : null}
      </div>
      {showNew ? <form id="new-app" onSubmit={submit} className="flex flex-wrap items-end gap-3.5 rounded-3xl bg-ink p-6 text-white">
        <div className="flex min-w-0 flex-[999_1_320px] flex-col gap-2"><label htmlFor="project-url" className="text-[13px] font-semibold text-haze">{t("websiteAddress")}</label><input id="project-url" type="text" inputMode="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder={t("urlPlaceholder")} disabled={creating} className="h-[52px] min-w-0 rounded-field-lg border border-white/20 bg-white/5 px-4 text-[17px]" /></div>
        <Button variant="lime" type="submit" disabled={creating || !url.trim()}>{t(creating ? "creating" : "createPreview")}</Button>
        {createError ? <div className="w-full"><Alert tone="danger">{createError}</Alert></div> : null}
      </form> : null}
      {error ? <div className="flex flex-col items-start gap-3"><Alert tone="danger">{t(error)}</Alert><Button onClick={() => { setError(null); setApps(null); setRetry(v=>v+1); }}>{t("retry")}</Button></div> : apps === null ? <p role="status">{t("loading")}</p> : apps.length ?
        <ul className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">{apps.map(app => <li key={app.id} className="min-w-0"><Link href={`/projects/${orgId}/${app.id}`} className="flex h-full flex-col gap-4.5 rounded-3xl bg-white p-[22px] transition hover:-translate-y-0.5 hover:shadow-card-hover motion-reduce:transform-none motion-reduce:transition-none">
          <div className="flex items-center gap-3.5"><span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-violet text-2xl font-extrabold text-white">{app.name.charAt(0)}</span><div className="min-w-0"><h2 className="break-words text-lg font-bold">{app.name}</h2><p className="truncate text-sm text-slate">{domain(app.sourceUrl)}</p></div></div>
          <div className="flex flex-wrap items-center justify-between gap-2.5">{app.statusUnavailable ? <span className="text-sm text-slate">{t("statusUnavailable")}</span> : <StatusBadge status={statusOf(app)}>{t(`status.${statusOf(app)}`)}</StatusBadge>}<time dateTime={app.updatedAt} className="text-[13px] text-slate">{t("updated",{ date: new Date(app.updatedAt).toLocaleDateString(locale) })}</time></div>
          <div className="mt-auto flex justify-between gap-2.5 border-t border-line pt-3.5 text-sm font-semibold"><span className="text-slate">{t(app.statusUnavailable ? "next.draft" : `next.${statusOf(app)}`)}</span><span className="text-violet">{t("openProject")} →</span></div>
        </Link></li>)}</ul> : <section className="flex flex-col items-center gap-4.5 rounded-[32px] bg-white px-6 py-16 text-center"><span aria-hidden="true" className="flex h-[88px] w-[88px] items-center justify-center rounded-[26px] bg-lilac text-violet"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M10.5 18.5h3"/></svg></span><h2 className="font-[family-name:var(--font-unbounded)] text-[26px] font-bold">{t("empty")}</h2><p className="max-w-[420px] leading-relaxed text-slate">{t("emptyBody")}</p><Button onClick={()=>setShowNew(true)}>{t("firstApp")}</Button></section>}
    </main>
  </div>;
}
