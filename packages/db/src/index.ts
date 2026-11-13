export * as schema from './schema';
// Re-exported so consumers building queries against `schema` use the same resolved
// drizzle-orm module graph as this package's own .d.ts was built against — importing
// eq/and straight from `drizzle-orm` in a consuming app can resolve a structurally
// identical but nominally different SQL<unknown> type (dual CJS/ESM resolution), which
// TypeScript then rejects as incompatible wherever it meets `schema`'s column types.
export { eq, and, or, lt, gt, desc, isNull, sql } from 'drizzle-orm';
export { createDb } from './client';
export type { Db } from './client';
export {
  runInTenantContext,
  runInUserContext,
  runInTokenLookupContext,
  runInClaimContext,
  runInBuildContext,
  runInPreviewLookupContext,
  getTenantDb,
} from './tenant-context';
export type { TenantIdentity } from './tenant-context';
