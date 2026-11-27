import { BadRequestException } from '@nestjs/common';
import { requireString, requireRole, optionalSegment } from './validation.js';

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

describe('optionalSegment', () => {
  it.each(['owner', 'agency', 'developer'] as const)('accepts %s', (segment) => {
    expect(optionalSegment(segment)).toBe(segment);
  });

  it.each([undefined, null])('returns undefined for %p (segment is optional)', (value) => {
    expect(optionalSegment(value)).toBeUndefined();
  });

  it.each(['freelancer', 42, ''])('throws BadRequestException for an invalid, present value %p', (value) => {
    expect(() => optionalSegment(value)).toThrow(BadRequestException);
  });
});
