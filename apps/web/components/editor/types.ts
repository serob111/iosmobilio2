import type { ProjectConfig } from "@mobilio/config";
import type { Builds } from "./BuildsBlock";

/**
 * What ProjectEditor needs from whichever thing it's editing — a draft or a claimed
 * project. Both backends are a full-replace PUT that echoes back the server's own
 * authoritative copy (id/bundleId/trial are server-owned regardless of what's sent), so
 * `save` has the identical shape either way; only the endpoints underneath differ.
 * `builds` is present only for ProjectAdapter — a draft has no stable bundleId/org to
 * build against yet, so the whole builds block simply doesn't render without it.
 */
export type ProjectEditorAdapter = {
  initialConfig: ProjectConfig;
  /** For <img src crossOrigin="use-credentials">; pass a fresh number after a successful upload to bust the browser's cache. */
  iconUrl: (cacheBust?: number) => string;
  /** This editor's own preview origin — created once by the caller, not re-created on every save. */
  proxyBase: string;
  save: (config: ProjectConfig) => Promise<ProjectConfig>;
  uploadIcon: (file: File) => Promise<void>;
  builds?: Builds;
};
