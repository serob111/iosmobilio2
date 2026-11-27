"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  ApiError,
  claimDraft,
  createOrganization,
  fetchMe,
  getMyDraft,
  type DraftSummary,
  type OrgSegment,
} from "@/lib/apiClient";
import { useApiErrorMessage } from "@/lib/errorCodes";
import { Logo } from "@/components/ui/Logo";
import { Panel } from "@/components/ui/Panel";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

const SEGMENTS: { id: OrgSegment; labelKey: "segmentOwner" | "segmentAgency" | "segmentDeveloper" }[] = [
  { id: "owner", labelKey: "segmentOwner" },
  { id: "agency", labelKey: "segmentAgency" },
  { id: "developer", labelKey: "segmentDeveloper" },
];

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

type Step =
  | { kind: "loading" }
  | { kind: "form" }
  | { kind: "saving"; workspaceName: string }
  | { kind: "done"; projectId: string; orgId: string }
  | { kind: "draftNotFound" }
  | { kind: "error"; message: string };

export default function WorkspacePage() {
  const t = useTranslations("workspace");
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();

  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [draft, setDraft] = useState<DraftSummary | null>(null);
  const [name, setName] = useState("");
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(null);
  const [segment, setSegment] = useState<OrgSegment | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [me, loadedDraft] = await Promise.all([fetchMe(), getMyDraft().catch(() => null)]);
      if (cancelled) return;
      if (!me) {
        router.replace("/login");
        return;
      }
      if (me.organizations.length > 0 || !loadedDraft) {
        router.replace("/projects");
        return;
      }
      setEmail(me.user.email);
      setDraft(loadedDraft);
      setName(loadedDraft.name);
      setStep({ kind: "form" });
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setStep({ kind: "saving", workspaceName: name.trim() });
    try {
      const orgId = createdOrgId ?? (await createOrganization(name.trim(), segment ?? undefined)).orgId;
      setCreatedOrgId(orgId);
      try {
        const { id: projectId } = await claimDraft(orgId);
        setStep({ kind: "done", projectId, orgId });
      } catch (claimError) {
        if (claimError instanceof ApiError && claimError.code === "DRAFT_NOT_FOUND") {
          setStep({ kind: "draftNotFound" });
        } else {
          setStep({ kind: "error", message: apiErrorMessage(claimError) });
        }
      }
    } catch (error) {
      setStep({ kind: "error", message: apiErrorMessage(error) });
    }
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-mist">
      <header className="flex items-center justify-between gap-4 px-5 py-7 sm:px-10 lg:px-20">
        <Logo />
        {email ? <span className="text-sm text-slate">{email}</span> : null}
      </header>

      <main className="flex flex-1 justify-center px-4 pb-16 pt-4 sm:px-6">
        <div className="flex w-full max-w-[560px] flex-col gap-5">
          {step.kind === "form" && draft ? (
            <div className="flex flex-col gap-5">
              <span className="text-sm font-semibold text-violet">{t("stepLabel")}</span>
              <h1 className="font-[family-name:var(--font-unbounded)] text-[32px] font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">
                {t("title")}
              </h1>
              <p className="-mt-2 text-base leading-relaxed text-slate sm:text-[17px]">{t("subtitle")}</p>

              <Panel className="flex flex-col gap-5 p-7">
                <form onSubmit={handleCreate} className="flex flex-col gap-5">
                  <Field label={t("nameLabel")} hint={t("nameHint")}>
                    <Input value={name} onChange={(event) => setName(event.target.value)} />
                  </Field>

                  <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
                    <legend className="mb-1 p-0 text-[13px] font-semibold text-slate">{t("segmentLegend")}</legend>
                    <div className="flex flex-wrap gap-2.5">
                      {SEGMENTS.map((s) => {
                        const pressed = segment === s.id;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            aria-pressed={pressed}
                            onClick={() => setSegment(pressed ? null : s.id)}
                            className={[
                              "min-h-11 rounded-pill px-4.5 text-[15px] font-semibold",
                              pressed ? "border-2 border-violet bg-lilac" : "border-[1.5px] border-line bg-white",
                            ].join(" ")}
                          >
                            {t(s.labelKey)}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>

                  <div className="flex items-center gap-3.5 rounded-2xl bg-mist-soft p-4">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#E8794A] text-xl font-extrabold text-white">
                      {draft.name.charAt(0).toUpperCase()}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-bold">{draft.name}</span>
                      <span className="truncate text-sm text-slate">
                        {t("draftFromBrowser", { domain: hostnameOf(draft.sourceUrl) })}
                      </span>
                    </div>
                    <span className="flex h-[30px] shrink-0 items-center rounded-pill bg-success-bg px-3 text-[13px] font-semibold text-success-fg">
                      {t("willBeSaved")}
                    </span>
                  </div>

                  <Button type="submit" disabled={!name.trim()} className="w-full">
                    {t("createButton")}
                  </Button>
                </form>
              </Panel>
            </div>
          ) : null}

          {step.kind === "saving" && draft ? (
            <Panel className="flex flex-col items-center gap-4.5 px-7 py-12 text-center">
              <span
                aria-hidden="true"
                className="h-11 w-11 animate-spin rounded-full border-4 border-lilac border-t-violet motion-reduce:animate-none"
              />
              <h1 className="font-[family-name:var(--font-unbounded)] text-2xl font-bold tracking-[-0.02em]">
                {t("savingTitle", { draftName: draft.name, workspaceName: step.workspaceName })}
              </h1>
              <p role="status" className="text-base text-slate">
                {t("savingBody")}
              </p>
            </Panel>
          ) : null}

          {step.kind === "done" && draft ? (
            <Panel tone="ink" className="flex flex-col items-center gap-4.5 px-7 py-10 text-center">
              <span aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-full bg-lime">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#17112E" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
              <h1 className="font-[family-name:var(--font-unbounded)] text-[28px] font-bold tracking-[-0.02em]">{t("doneTitle")}</h1>
              <p className="max-w-[380px] text-base leading-relaxed text-haze">
                {t("doneBody", { draftName: draft.name })}
              </p>
              <Button variant="lime" onClick={() => router.push(`/projects/${step.orgId}/${step.projectId}`)}>
                {t("doneCta")}
              </Button>
            </Panel>
          ) : null}

          {step.kind === "draftNotFound" ? (
            <Panel className="flex flex-col gap-3.5 p-7">
              <h1 className="font-[family-name:var(--font-unbounded)] text-2xl font-bold tracking-[-0.02em]">
                {t("draftNotFoundTitle")}
              </h1>
              <p className="text-base leading-relaxed text-slate">{t("draftNotFoundBody")}</p>
              <Button className="self-start" onClick={() => router.push("/projects")}>
                {t("draftNotFoundCta")}
              </Button>
            </Panel>
          ) : null}

          {step.kind === "error" ? (
            <div className="flex flex-col gap-4">
              <Alert tone="danger">{step.message}</Alert>
              <Button className="self-start" onClick={() => setStep({ kind: "form" })}>
                {t("createButton")}
              </Button>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
