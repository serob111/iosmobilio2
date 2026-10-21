import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleGuard } from './role.guard.js';
import './organizations.types.js';

function contextWithRequest(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

function fakeReflector(required: string[] | undefined) {
  return { get: () => required } as unknown as Reflector;
}

describe('RoleGuard', () => {
  it('allows the request when no @Roles() metadata is present', () => {
    const guard = new RoleGuard(fakeReflector(undefined));
    const ctx = contextWithRequest({ membership: { role: 'member' } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows the request when the membership role is in the required list', () => {
    const guard = new RoleGuard(fakeReflector(['owner', 'admin']));
    const ctx = contextWithRequest({ membership: { role: 'admin' } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws ForbiddenException when the membership role is not allowed', () => {
    const guard = new RoleGuard(fakeReflector(['owner', 'admin']));
    const ctx = contextWithRequest({ membership: { role: 'member' } });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when there is no membership on the request', () => {
    const guard = new RoleGuard(fakeReflector(['owner']));
    const ctx = contextWithRequest({});
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
