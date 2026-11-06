import type { ProjectConfig } from "@mobilio/config";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3011";

/**
 * Every apps/api error response is `{error: {code, message, requestId}}` (English,
 * stable codes — never meant to be shown directly, see lib/errorCodes.ts for the code
 * -> localized-message mapping; see apps/api's HttpExceptionFilter for where this
 * shape comes from). Carrying `code` as a typed property (not just embedded in the
 * message string) is what lets the UI translate by code instead of parsing English text.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function throwApiError(res: Response): Promise<never> {
  const body: unknown = await res.json().catch(() => null);
  const error =
    body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "object"
      ? ((body as { error: unknown }).error as Record<string, unknown>)
      : null;
  const code = error && typeof error.code === "string" ? error.code : "UNKNOWN";
  const message =
    error && typeof error.message === "string" ? error.message : `Request failed with status ${res.status}`;
  throw new ApiError(code, message);
}

export interface MeUser {
  id: string;
  name: string;
  email: string;
}

export type OrgRole = "owner" | "admin" | "member";

export interface MeOrganization {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
}

export interface MeResponse {
  user: MeUser;
  organizations: MeOrganization[];
}

/** Returns null when signed out (401) rather than throwing — that's the expected, common case here. */
export async function fetchMe(): Promise<MeResponse | null> {
  const res = await fetch(`${API_BASE_URL}/me`, { credentials: "include" });
  if (res.status === 401) {
    return null;
  }
  if (!res.ok) {
    return throwApiError(res);
  }
  return res.json() as Promise<MeResponse>;
}

export interface Tab {
  title: string;
  icon: string;
  path?: string;
  native?: "contacts";
}

export interface Theme {
  primary: string;
  background: string;
  statusBar: "dark" | "light";
}

/** The public shape served by GET /preview/:slug — never ids, raw config, or anything beyond what the shell needs to render. */
export interface PreviewDto {
  name: string;
  theme: Theme;
  statusBar: "dark" | "light";
  tabs: Tab[];
  iconUrl: string;
  proxyBase: string;
}

export async function fetchPreviewDto(slug: string): Promise<PreviewDto | null> {
  const res = await fetch(`${API_BASE_URL}/preview/${slug}`);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    return throwApiError(res);
  }
  return res.json() as Promise<PreviewDto>;
}

export interface DraftSummary {
  id: string;
  name: string;
  sourceUrl: string;
  config: ProjectConfig;
  configVersion: number;
  expiresAt: string;
}

/** POST /drafts only sets the httpOnly draft cookie and returns {ok:true} — the caller never sees the raw token, so the actual draft info is fetched separately via getMyDraft(). */
export async function createDraft(url: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/drafts`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
}

/** Identity comes entirely from the httpOnly draft cookie set by createDraft() — credentials:'include' is required. */
export async function getMyDraft(): Promise<DraftSummary | null> {
  const res = await fetch(`${API_BASE_URL}/drafts/me`, { credentials: "include" });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    return throwApiError(res);
  }
  return res.json() as Promise<DraftSummary>;
}

/** Full-replace — the server owns `id`/`bundleId`/`trial` regardless of what's sent and echoes back its own authoritative copy. */
export async function updateDraftConfig(config: ProjectConfig): Promise<ProjectConfig> {
  const res = await fetch(`${API_BASE_URL}/drafts/me`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return res.json() as Promise<ProjectConfig>;
}

export async function uploadDraftIcon(file: File): Promise<void> {
  const formData = new FormData();
  formData.append("icon", file);
  const res = await fetch(`${API_BASE_URL}/drafts/me/icon`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  if (!res.ok) {
    return throwApiError(res);
  }
}

/** For <img src>/crossOrigin="use-credentials"> — the endpoint streams the bytes itself (not a redirect: a signed S3/MinIO url is a third origin whose CORS can't satisfy a credentialed request). `v` is a cache-busting value (e.g. Date.now()) to force a reload right after a fresh upload. */
export function draftIconUrl(v?: number): string {
  return `${API_BASE_URL}/drafts/me/icon${v !== undefined ? `?v=${v}` : ""}`;
}

/** The editor's own live-preview iframe link — create fresh every time the editor page loads, never revokes anything (a share link the user already sent out keeps working). */
export async function createDraftEditorPreviewLink(): Promise<{ url: string }> {
  const res = await fetch(`${API_BASE_URL}/drafts/me/preview-link/editor`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return res.json() as Promise<{ url: string }>;
}

/** The current active share link, if any — null (not an error) when none has been created yet. */
export async function fetchDraftPreviewLink(): Promise<{ url: string } | null> {
  const res = await fetch(`${API_BASE_URL}/drafts/me/preview-link`, { credentials: "include" });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    return throwApiError(res);
  }
  return res.json() as Promise<{ url: string }>;
}

/** Creates a share link only if none is currently active; returns the existing one otherwise. */
export async function createDraftPreviewLink(): Promise<{ url: string }> {
  const res = await fetch(`${API_BASE_URL}/drafts/me/preview-link`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return res.json() as Promise<{ url: string }>;
}

/** Explicitly revokes whatever share link is active and creates a brand new one. */
export async function regenerateDraftPreviewLink(): Promise<{ url: string }> {
  const res = await fetch(`${API_BASE_URL}/drafts/me/preview-link/regenerate`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return res.json() as Promise<{ url: string }>;
}

export async function claimDraft(orgId: string): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE_URL}/orgs/${orgId}/drafts/claim`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return res.json() as Promise<{ id: string }>;
}

export interface ProjectSummary {
  id: string;
  name: string;
  sourceUrl: string;
  createdAt: string;
  updatedAt: string;
}

export async function listProjects(orgId: string): Promise<ProjectSummary[]> {
  const res = await fetch(`${API_BASE_URL}/orgs/${orgId}/projects`, { credentials: "include" });
  if (!res.ok) {
    return throwApiError(res);
  }
  return res.json() as Promise<ProjectSummary[]>;
}

export interface ProjectInfo {
  id: string;
  name: string;
  sourceUrl: string;
  config: ProjectConfig;
  configVersion: number;
}

export async function fetchProject(orgId: string, projectId: string): Promise<ProjectInfo | null> {
  const res = await fetch(`${API_BASE_URL}/orgs/${orgId}/projects/${projectId}`, { credentials: "include" });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    return throwApiError(res);
  }
  return res.json() as Promise<ProjectInfo>;
}

/** Full-replace — same server-owned-fields contract as updateDraftConfig. */
export async function updateProjectConfig(orgId: string, projectId: string, config: ProjectConfig): Promise<ProjectConfig> {
  const res = await fetch(`${API_BASE_URL}/orgs/${orgId}/projects/${projectId}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return res.json() as Promise<ProjectConfig>;
}

export async function uploadProjectIcon(orgId: string, projectId: string, file: File): Promise<void> {
  const formData = new FormData();
  formData.append("icon", file);
  const res = await fetch(`${API_BASE_URL}/orgs/${orgId}/projects/${projectId}/icon`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  if (!res.ok) {
    return throwApiError(res);
  }
}

export function projectIconUrl(orgId: string, projectId: string, v?: number): string {
  return `${API_BASE_URL}/orgs/${orgId}/projects/${projectId}/icon${v !== undefined ? `?v=${v}` : ""}`;
}

/** The editor's own live-preview iframe link — create fresh every time the editor page loads, never revokes anything (a share link the user already sent out keeps working). */
export async function createProjectEditorPreviewLink(orgId: string, projectId: string): Promise<{ url: string }> {
  const res = await fetch(`${API_BASE_URL}/orgs/${orgId}/projects/${projectId}/preview-link/editor`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return res.json() as Promise<{ url: string }>;
}

/** The current active share link, if any — null (not an error) when none has been created yet. */
export async function fetchProjectPreviewLink(orgId: string, projectId: string): Promise<{ url: string } | null> {
  const res = await fetch(`${API_BASE_URL}/orgs/${orgId}/projects/${projectId}/preview-link`, { credentials: "include" });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    return throwApiError(res);
  }
  return res.json() as Promise<{ url: string }>;
}

/** Creates a share link only if none is currently active; returns the existing one otherwise. */
export async function createProjectPreviewLink(orgId: string, projectId: string): Promise<{ url: string }> {
  const res = await fetch(`${API_BASE_URL}/orgs/${orgId}/projects/${projectId}/preview-link`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return res.json() as Promise<{ url: string }>;
}

/** Explicitly revokes whatever share link is active and creates a brand new one. */
export async function regenerateProjectPreviewLink(orgId: string, projectId: string): Promise<{ url: string }> {
  const res = await fetch(`${API_BASE_URL}/orgs/${orgId}/projects/${projectId}/preview-link/regenerate`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return res.json() as Promise<{ url: string }>;
}

export type BuildStatus = "queued" | "building" | "done" | "failed";

export interface BuildSummary {
  id: string;
  status: BuildStatus;
  runId: number | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export async function startBuild(orgId: string, projectId: string): Promise<{ id: string; status: BuildStatus }> {
  const res = await fetch(`${API_BASE_URL}/orgs/${orgId}/projects/${projectId}/builds`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return res.json() as Promise<{ id: string; status: BuildStatus }>;
}

export async function listBuilds(orgId: string, projectId: string): Promise<BuildSummary[]> {
  const res = await fetch(`${API_BASE_URL}/orgs/${orgId}/projects/${projectId}/builds`, { credentials: "include" });
  if (!res.ok) {
    return throwApiError(res);
  }
  return res.json() as Promise<BuildSummary[]>;
}

export async function getBuild(orgId: string, projectId: string, buildId: string): Promise<BuildSummary> {
  const res = await fetch(`${API_BASE_URL}/orgs/${orgId}/projects/${projectId}/builds/${buildId}`, {
    credentials: "include",
  });
  if (!res.ok) {
    return throwApiError(res);
  }
  return res.json() as Promise<BuildSummary>;
}

/** The actual download link — intentionally a plain href, not fetched by this client: it's a @Redirect() to a signed URL, and the browser following it directly avoids buffering a multi-MB file through JS. Note this is deliberately NOT runUrl (the GitHub Actions run URL) — that's never exposed to the client at all (see builds.controller.ts's BuildSummary). */
export function buildIpaUrl(orgId: string, projectId: string, buildId: string): string {
  return `${API_BASE_URL}/orgs/${orgId}/projects/${projectId}/builds/${buildId}/ipa`;
}
