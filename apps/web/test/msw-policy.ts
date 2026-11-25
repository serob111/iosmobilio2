import { http, HttpResponse, passthrough } from 'msw';
import { isAllowedNetworkHost } from './allowed-network-hosts.js';

/**
 * Same approach as apps/api/test/msw-policy.ts — see that file for the full reasoning
 * (msw@3.0.4's `onUnhandledFrame` listen() option doesn't reject the caller's fetch()
 * the way v2's `onUnhandledRequest: 'error'` did, so a catch-all handler is used
 * instead).
 *
 * Registered once as setupServer()'s own initial handler (see mocks/server.ts) so
 * afterEach(() => server.resetHandlers()) always restores it — every request matches
 * *some* handler now, so there's nothing left "unhandled" to configure a policy for.
 *
 * server.use(...)'s own handlers are prepended ahead of this one (msw's documented
 * behavior), so any test's own mocked handler for a specific URL always matches first;
 * this only ever runs for a request nothing more specific claimed.
 *
 * Allowed hosts (see allowed-network-hosts.ts) get passthrough(); everything else gets
 * HttpResponse.error() — the one msw response type that genuinely rejects the caller's
 * fetch() — so a disallowed, unmocked request fails loudly and immediately instead of
 * reaching the real internet.
 */
export const mswLocalOnlyCatchAllHandler = http.all('*', ({ request }) => {
  const host = new URL(request.url).hostname;
  return isAllowedNetworkHost(host) ? passthrough() : HttpResponse.error();
});
