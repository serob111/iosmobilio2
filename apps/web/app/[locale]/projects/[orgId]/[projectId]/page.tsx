"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createProjectPreviewLink, fetchPreviewDto, fetchProject } from "@/lib/apiClient";
import { ProjectEditor } from "@/components/editor/ProjectEditor";
import { createProjectAdapter } from "@/components/editor/ProjectAdapter";
import type { ProjectEditorAdapter } from "@/components/editor/types";
import { PreviewLinkButton } from "@/components/preview/PreviewLinkButton";

type State = { status: "loading" } | { status: "not-found" } | { status: "ready"; adapter: ProjectEditorAdapter };

export default function ProjectPage() {
  const t = useTranslations("projects");
  const params = useParams<{ orgId: string; projectId: string }>();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    (async () => {
      const project = await fetchProject(params.orgId, params.projectId);
      if (!project) {
        setState({ status: "not-found" });
        return;
      }
      const { url } = await createProjectPreviewLink(params.orgId, params.projectId);
      const slug = url.split("/preview/")[1];
      const dto = slug ? await fetchPreviewDto(slug) : null;
      if (!dto) {
        setState({ status: "not-found" });
        return;
      }
      setState({
        status: "ready",
        adapter: createProjectAdapter(params.orgId, params.projectId, dto.proxyBase, project.config),
      });
    })().catch(() => setState({ status: "not-found" }));
  }, [params.orgId, params.projectId]);

  if (state.status === "loading") {
    return null;
  }
  if (state.status === "not-found") {
    return <div className="flex flex-1 items-center justify-center text-zinc-500">{t("notFound")}</div>;
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-6 bg-zinc-50 pb-12">
      <ProjectEditor adapter={state.adapter} />
      <PreviewLinkButton createLink={() => createProjectPreviewLink(params.orgId, params.projectId)} />
    </div>
  );
}
