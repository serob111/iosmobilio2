import type { ProjectConfig } from "@mobilio/config";
import { draftIconUrl, updateDraftConfig, uploadDraftIcon } from "@/lib/apiClient";
import type { ProjectEditorAdapter } from "./types";

/** A draft has no stable org/bundleId to build against yet — no `builds` field at all, so BuildsBlock simply never renders for a draft. */
export function createDraftAdapter(proxyBase: string, initialConfig: ProjectConfig): ProjectEditorAdapter {
  return {
    initialConfig,
    iconUrl: (v) => draftIconUrl(v),
    proxyBase,
    save: (config) => updateDraftConfig(config),
    uploadIcon: (file) => uploadDraftIcon(file),
  };
}
