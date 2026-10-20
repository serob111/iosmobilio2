import { describe, expect, it } from 'vitest';
import { getTenantDb } from '../src/tenant-context';

describe('getTenantDb', () => {
  it('throws when called outside runInTenantContext', () => {
    expect(() => getTenantDb()).toThrow(/outside runInTenantContext/);
  });
});
