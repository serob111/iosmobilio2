import { InternalServerErrorException, type ExecutionContext } from '@nestjs/common';
import { tenantParamFactory } from './tenant.decorator.js';
import './tenant.types.js';

function contextWithRequest(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('tenantParamFactory', () => {
  it('returns request.tenant when OrgGuard has set it', () => {
    const tenant = { orgId: 'org-1', userId: 'user-1' };
    const ctx = contextWithRequest({ tenant });
    expect(tenantParamFactory(undefined, ctx)).toBe(tenant);
  });

  it('throws when request.tenant is missing', () => {
    const ctx = contextWithRequest({});
    expect(() => tenantParamFactory(undefined, ctx)).toThrow(InternalServerErrorException);
  });
});
