import type { OrgRole } from './organizations.service.js';

export interface MembershipInfo {
  role: OrgRole;
}

declare module 'express' {
  interface Request {
    /** Set by OrgGuard once it has verified the caller belongs to the org in the path. */
    membership?: MembershipInfo;
  }
}
