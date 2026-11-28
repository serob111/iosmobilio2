import { setupServer } from 'msw/node';
import { mswLocalOnlyCatchAllHandler } from '../msw-policy.js';

// Passed to setupServer() itself, not added later via .use() — resetHandlers() (called
// in every spec's afterEach) restores exactly this initial list, so the policy can
// never be accidentally reset away mid-suite. See msw-policy.ts for what it does.
export const server = setupServer(mswLocalOnlyCatchAllHandler);
