import type { TenantIdentity } from '@mobilio/db';

export type { TenantIdentity };

declare module 'express' {
  interface Request {
    /** Set by OrgGuard once it has verified the caller belongs to the org in the path. */
    tenant?: TenantIdentity;
  }
}
