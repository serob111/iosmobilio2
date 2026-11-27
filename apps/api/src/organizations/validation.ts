import { BadRequestException } from '@nestjs/common';
import type { OrgRole, OrgSegment } from './organizations.service.js';

const VALID_ROLES: OrgRole[] = ['owner', 'admin', 'member'];
const VALID_SEGMENTS: OrgSegment[] = ['owner', 'agency', 'developer'];

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: `${field} is required` });
  }
  return value;
}

export function requireRole(value: unknown): OrgRole {
  if (typeof value !== 'string' || !VALID_ROLES.includes(value as OrgRole)) {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'role must be one of owner, admin, member' });
  }
  return value as OrgRole;
}

/** Unlike requireRole, this is genuinely optional — `undefined` (field omitted) is valid; only a present-but-invalid value is rejected. */
export function optionalSegment(value: unknown): OrgSegment | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !VALID_SEGMENTS.includes(value as OrgSegment)) {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'segment must be one of owner, agency, developer' });
  }
  return value as OrgSegment;
}
