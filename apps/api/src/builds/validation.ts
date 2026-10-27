import { BadRequestException } from '@nestjs/common';

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: `${field} is required` });
  }
  return value;
}

export function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: `${field} must be a number` });
  }
  return value;
}
