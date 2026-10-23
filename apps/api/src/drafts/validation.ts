import { BadRequestException } from '@nestjs/common';

export function requireUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Укажите адрес сайта' });
  }
  return value;
}
