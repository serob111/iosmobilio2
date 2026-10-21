import { BadRequestException } from '@nestjs/common';
import { requireString, requireRole } from './validation.js';

describe('requireString', () => {
  it('returns the value when it is a non-empty string', () => {
    expect(requireString('hi', 'name')).toBe('hi');
  });

  it.each([undefined, null, 42, '', '   '])('throws BadRequestException for %p', (value) => {
    expect(() => requireString(value, 'name')).toThrow(BadRequestException);
  });
});

describe('requireRole', () => {
  it.each(['owner', 'admin', 'member'] as const)('accepts %s', (role) => {
    expect(requireRole(role)).toBe(role);
  });

  it.each([undefined, null, 'superuser', 42])('throws BadRequestException for %p', (value) => {
    expect(() => requireRole(value)).toThrow(BadRequestException);
  });
});
