import { createAuthClient } from 'better-auth/react';
import { magicLinkClient } from 'better-auth/client/plugins';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3011';

/** Talks to apps/api directly (not through this Next server) — /api/auth is Better Auth's own default mount path, matching apps/api's main.ts. */
export const authClient = createAuthClient({
  baseURL: API_BASE_URL,
  plugins: [magicLinkClient()],
});
