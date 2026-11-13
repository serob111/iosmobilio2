"use client";

import { useEffect, useState } from "react";
import { useParams, usePathname as useNextPathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  ApiError,
  createProjectEditorPreviewLink,
  createProjectPreviewLink,
  fetchPreviewDto,
  fetchProject,
  fetchProjectPreviewLink,
  regenerateProjectPreviewLink,
} from "@/lib/apiClient";
import { ProjectEditor } from "@/components/editor/ProjectEditor";
import { createProjectAdapter } from "@/components/editor/ProjectAdapter";
import type { ProjectEditorAdapter } from "@/components/editor/types";
import { PreviewLinkButton } from "@/components/preview/PreviewLinkButton";

type State =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error" }
  | { status: "ready"; adapter: ProjectEditorAdapter };

export default function ProjectPage() {
  const t = useTranslations("projects");
  const router = useRouter();
  const pathname = useNextPathname();
  const params = useParams<{ orgId: string; projectId: string }>();
  const [state, setState] = useState<State>({ status: "loading" });
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const project = await fetchProject(params.orgId, params.projectId);
      if (cancelled) return;
      if (!project) {
        setState({ status: "not-found" });
        return;
      }
      const { url } = await createProjectEditorPreviewLink(params.orgId, params.projectId);
      if (cancelled) return;
      const slug = url.split("/preview/")[1];
      const dto = slug ? await fetchPreviewDto(slug) : null;
      if (cancelled) return;
      if (!dto) {
        setState({ status: "not-found" });
        return;
      }
      setState({
        status: "ready",
        adapter: createProjectAdapter(params.orgId, params.projectId, dto.proxyBase, project.config),
      });
    })().catch((error: unknown) => {
      if (cancelled) return;
      if (error instanceof ApiError && error.code === "UNAUTHORIZED") {
        router.push({ pathname: "/login", query: { callbackUrl: pathname } });
        return;
      }
      setState({ status: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [params.orgId, params.projectId, retryCount, router, pathname]);

  if (state.status === "loading") {
    return null;
  }
  if (state.status === "not-found") {
    return <div className="flex flex-1 items-center justify-center text-zinc-500">{t("notFound")}</div>;
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <p className="text-sm text-red-600">{t("loadError")}</p>
        <button
          type="button"
          onClick={() => {
            setState({ status: "loading" });
            setRetryCount((n) => n + 1);
          }}
          className="rounded-full bg-[#4B2BE0] px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
        >
          {t("retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-6 bg-zinc-50 pb-12">
      <ProjectEditor adapter={state.adapter} />
      <PreviewLinkButton
        fetchLink={() => fetchProjectPreviewLink(params.orgId, params.projectId)}
        createLink={() => createProjectPreviewLink(params.orgId, params.projectId)}
        regenerateLink={() => regenerateProjectPreviewLink(params.orgId, params.projectId)}
      />
    </div>
  );
}
