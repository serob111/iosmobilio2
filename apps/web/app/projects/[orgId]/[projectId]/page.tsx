"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createProjectPreviewLink, fetchProject, type ProjectSummary } from "@/lib/apiClient";
import { PreviewLinkButton } from "@/components/preview/PreviewLinkButton";

type State = { status: "loading" } | { status: "ready"; project: ProjectSummary } | { status: "not-found" };

/**
 * Minimal, read-only project page — just enough to host the "Открыть на iPhone" button
 * the preview spec asks for on a project page. Deliberately not the legacy /p/[id]
 * editing UI (no theme/tabs editor, no icon upload, no build trigger) — porting that is
 * its own, separate migration step this task doesn't touch.
 */
export default function ProjectPage() {
  const params = useParams<{ orgId: string; projectId: string }>();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    fetchProject(params.orgId, params.projectId)
      .then((project) => setState(project ? { status: "ready", project } : { status: "not-found" }))
      .catch(() => setState({ status: "not-found" }));
  }, [params.orgId, params.projectId]);

  if (state.status === "loading") {
    return <div className="flex flex-1 items-center justify-center text-zinc-500">Загрузка…</div>;
  }
  if (state.status === "not-found") {
    return <div className="flex flex-1 items-center justify-center text-zinc-500">Проект не найден</div>;
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-6 bg-zinc-50 px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{state.project.name}</h1>
      <PreviewLinkButton createLink={() => createProjectPreviewLink(params.orgId, params.projectId)} />
    </div>
  );
}
