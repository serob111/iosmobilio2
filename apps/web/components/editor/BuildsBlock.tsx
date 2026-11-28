"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { BuildStepTiming, BuildSummary, BuildStatus } from "@/lib/apiClient";
import { useApiErrorMessage } from "@/lib/errorCodes";

const RUNNING_STATUSES: BuildStatus[] = ["queued", "building"];
const POLL_INTERVAL_MS = 5_000;

export type Builds = {
  start: () => Promise<{ id: string; status: BuildStatus }>;
  list: () => Promise<BuildSummary[]>;
  get: (buildId: string) => Promise<BuildSummary>;
  /** The .ipa's direct download href (a @Redirect() to a signed URL) — never fetched by this component itself, just linked to. */
  ipaUrl: (buildId: string) => string;
  /** itms-services://?action=download-manifest&url=... — what actually triggers iOS's own OTA-install prompt; merely downloading the raw .ipa does nothing useful on a device. */
  installUrl: (buildId: string) => string;
};

/** "ensureAdHocProfile" -> "Ensure Ad Hoc Profile" — every repack step name humanized, with no per-step translation to maintain as packages/repacker/apps/worker's own step list grows. */
function humanizeStepName(step: string): string {
  const withSpaces = step.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/**
 * Real steps from the build's own step_timings (apps/api's BuildSummary), written
 * incrementally by the worker as it actually progresses — never a simulated/animated
 * progress bar. Only ever populated for 'adhoc' (repack) builds; stays empty for the
 * 'appstore'/GitHub-Actions path, which has no equivalent per-step breakdown.
 */
function BuildProgress({ steps }: { steps: BuildStepTiming[] }) {
  const t = useTranslations("builds");
  if (steps.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-xs text-zinc-600">
      <li className="font-semibold text-zinc-700">{t("progress")}</li>
      {steps.map((step, index) => (
        <li key={`${step.step}-${index}`} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="text-green-600">
            ✓
          </span>
          <span>{humanizeStepName(step.step)}</span>
          <span className="text-zinc-400">{formatDuration(step.durationMs)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Hidden behind NEXT_PUBLIC_ENABLE_BUILDS (default off, see README) — until the app ships
 * through Ad Hoc/TestFlight, an unsigned .ipa is useless to a client, so this whole block
 * would just be confusing surface area. Deliberately never renders `runId`/a GitHub
 * Actions run link — BuildSummary carries a `runUrl` field server-side, but this
 * component's own `BuildSummary` type (lib/apiClient.ts) omits it on purpose.
 */
export function BuildsBlock({ builds }: { builds: Builds }) {
  const t = useTranslations("builds");
  const apiErrorMessage = useApiErrorMessage();
  const [latest, setLatest] = useState<BuildSummary | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    builds
      .list()
      .then((all) => setLatest(all[0] ?? null))
      .catch(() => {
        // No build yet / listing failed — the "start" button covers this either way.
      });
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `builds` is a stable adapter object for the lifetime of this editor instance.
  }, []);

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (!latest || !RUNNING_STATUSES.includes(latest.status)) {
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const updated = await builds.get(latest.id);
        setLatest(updated);
      } catch {
        // A transient poll failure isn't worth surfacing — the next tick tries again.
      }
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.id, latest?.status]);

  async function handleStart() {
    setStarting(true);
    setError(null);
    try {
      const { id, status } = await builds.start();
      setLatest({ id, status, runId: null, error: null, startedAt: null, finishedAt: null, createdAt: new Date().toISOString(), stepTimings: null });
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setStarting(false);
    }
  }

  const statusLabel: Record<BuildStatus, string> = {
    queued: t("statusQueued"),
    building: t("statusBuilding"),
    done: t("statusDone"),
    failed: t("statusFailed"),
  };

  return (
    <section className="rounded-xl border border-zinc-200 p-4">
      <h2 className="text-sm font-semibold text-zinc-900">{t("title")}</h2>
      <div className="mt-3 flex flex-col gap-2">
        {latest ? <p className="text-sm text-zinc-700">{statusLabel[latest.status]}</p> : null}
        {latest && RUNNING_STATUSES.includes(latest.status) ? <BuildProgress steps={latest.stepTimings ?? []} /> : null}
        {!latest || latest.status === "done" || latest.status === "failed" ? (
          <button
            type="button"
            onClick={handleStart}
            disabled={starting || (!!latest && RUNNING_STATUSES.includes(latest.status))}
            className="w-fit rounded-full border border-zinc-300 px-5 py-2 text-sm font-semibold text-[#17112E] hover:bg-zinc-50 disabled:opacity-50"
          >
            {starting ? t("starting") : t("start")}
          </button>
        ) : null}
        {latest?.status === "done" ? (
          <>
            <a href={builds.installUrl(latest.id)} className="w-fit text-sm font-semibold text-[#4B2BE0] underline">
              {t("installOnIphone")}
            </a>
            <a href={builds.ipaUrl(latest.id)} className="w-fit text-xs font-medium text-zinc-500 underline">
              {t("downloadIpa")}
            </a>
            <p className="text-xs text-zinc-500">{t("disclaimer")}</p>
          </>
        ) : null}
        {latest?.status === "failed" && latest.error ? (
          <p className="text-sm text-red-600">
            {t("error")}: {latest.error}
          </p>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    </section>
  );
}
