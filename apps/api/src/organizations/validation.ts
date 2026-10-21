import { BadRequestException } from '@nestjs/common';
import type { OrgRole } from './organizations.service.js';

const VALID_ROLES: OrgRole[] = ['owner', 'admin', 'member'];

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
