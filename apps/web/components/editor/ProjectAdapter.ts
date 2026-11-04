import type { ProjectConfig } from "@mobilio/config";
import {
  buildIpaUrl,
  getBuild,
  listBuilds,
  projectIconUrl,
  startBuild,
  updateProjectConfig,
  uploadProjectIcon,
} from "@/lib/apiClient";
import type { ProjectEditorAdapter } from "./types";

const ENABLE_BUILDS = process.env.NEXT_PUBLIC_ENABLE_BUILDS === "true";

export function createProjectAdapter(
  orgId: string,
  projectId: string,
  proxyBase: string,
  initialConfig: ProjectConfig,
): ProjectEditorAdapter {
  return {
    initialConfig,
    iconUrl: (v) => projectIconUrl(orgId, projectId, v),
    proxyBase,
    save: (config) => updateProjectConfig(orgId, projectId, config),
    uploadIcon: (file) => uploadProjectIcon(orgId, projectId, file),
    builds: ENABLE_BUILDS
      ? {
          start: () => startBuild(orgId, projectId),
          list: () => listBuilds(orgId, projectId),
          get: (buildId) => getBuild(orgId, projectId, buildId),
          ipaUrl: (buildId) => buildIpaUrl(orgId, projectId, buildId),
        }
      : undefined,
  };
}
