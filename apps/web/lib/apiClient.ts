const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3011';

export interface MeUser {
  id: string;
  name: string;
  email: string;
}

export type OrgRole = 'owner' | 'admin' | 'member';

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
  const res = await fetch(`${API_BASE_URL}/me`, { credentials: 'include' });
  if (res.status === 401) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`GET /me failed with status ${res.status}`);
  }
  return res.json() as Promise<MeResponse>;
}

export interface Tab {
  title: string;
  icon: string;
  path?: string;
  native?: 'contacts';
}

export interface Theme {
  primary: string;
  background: string;
  statusBar: 'dark' | 'light';
}

/** The public shape served by GET /preview/:slug — never ids, raw config, or anything beyond what the shell needs to render. */
export interface PreviewDto {
  name: string;
  theme: Theme;
  statusBar: 'dark' | 'light';
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
    throw new Error(`GET /preview/${slug} failed with status ${res.status}`);
  }
  return res.json() as Promise<PreviewDto>;
}

export interface DraftSummary {
  id: string;
  name: string;
  sourceUrl: string;
  expiresAt: string;
}

/** POST /drafts only sets the httpOnly draft cookie and returns {ok:true} — the caller never sees the raw token, so the actual draft info is fetched separately via getMyDraft(). */
export async function createDraft(url: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/drafts`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `POST /drafts failed with status ${res.status}`);
  }
}

/** Identity comes entirely from the httpOnly draft cookie set by createDraft() — credentials:'include' is required. */
export async function getMyDraft(): Promise<DraftSummary | null> {
  const res = await fetch(`${API_BASE_URL}/drafts/me`, { credentials: 'include' });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`GET /drafts/me failed with status ${res.status}`);
  }
  return res.json() as Promise<DraftSummary>;
}

export async function createDraftPreviewLink(): Promise<{ url: string }> {
  const res = await fetch(`${API_BASE_URL}/drafts/me/preview-link`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`POST /drafts/me/preview-link failed with status ${res.status}`);
  }
  return res.json() as Promise<{ url: string }>;
}

export async function claimDraft(orgId: string): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE_URL}/orgs/${orgId}/drafts/claim`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`POST /orgs/${orgId}/drafts/claim failed with status ${res.status}`);
  }
  return res.json() as Promise<{ id: string }>;
}

export interface ProjectSummary {
  id: string;
  name: string;
}

export async function fetchProject(orgId: string, projectId: string): Promise<ProjectSummary | null> {
  const res = await fetch(`${API_BASE_URL}/orgs/${orgId}/projects/${projectId}`, { credentials: 'include' });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`GET /orgs/${orgId}/projects/${projectId} failed with status ${res.status}`);
  }
  return res.json() as Promise<ProjectSummary>;
}

export async function createProjectPreviewLink(orgId: string, projectId: string): Promise<{ url: string }> {
  const res = await fetch(`${API_BASE_URL}/orgs/${orgId}/projects/${projectId}/preview-link`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`POST .../preview-link failed with status ${res.status}`);
  }
  return res.json() as Promise<{ url: string }>;
}
