import { SetMetadata } from '@nestjs/common';
import type { OrgRole } from './organizations.service.js';

export const ROLES_KEY = 'roles';

/** Must be paired with OrgGuard running first — RoleGuard reads request.membership, which only OrgGuard sets. */
export const Roles = (...roles: OrgRole[]) => SetMetadata(ROLES_KEY, roles);
