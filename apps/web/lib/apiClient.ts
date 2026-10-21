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
