import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './mocks/server';

// No onUnhandledFrame option here — msw@3.0.4 renamed v2's onUnhandledRequest to
// onUnhandledFrame with a shape that doesn't reject the caller's fetch() on an
// unmatched request (see test/msw-policy.ts). The catch-all handler registered in
// mocks/server.ts handles that instead.
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
