import { http, HttpResponse, passthrough } from 'msw';
import { isAllowedNetworkHost } from './allowed-network-hosts.js';

/**
 * Correction from the original plan: msw@3.0.4 doesn't actually have an
 * `onUnhandledRequest` option at all — that's msw v2's name. This version renamed it
 * to `onUnhandledFrame`, with a different callback shape ((args: { frame, defaults })
 * => void, not (request, print) => void), and — worse — throwing/erroring from inside
 * that callback doesn't reject the caller's fetch() the way 'error' is documented to;
 * it just resolves with a synthesized 500 Response. Every one of this app's specs that
 * set `onUnhandledRequest: 'bypass'|'error'` (cast through `as Parameters<typeof
 * server.listen>[0]` to silence the resulting type error) was therefore setting an
 * option that doesn't exist and silently fell back to msw's actual default — which,
 * confirmed by tracing it, genuinely attempts the real network for anything no handler
 * matches. 'bypass' and 'error' were drawing an identical, false sense of security.
 *
 * This sidesteps the whole onUnhandledFrame question instead of fighting its API: a
 * catch-all handler, registered once as setupServer()'s own initial handler (see
 * mocks/server.ts) so afterEach(() => server.resetHandlers()) always restores it —
 * every request now matches *some* handler, so there's nothing left "unhandled" to
 * configure a policy for, and no listen()-time option (hence no type-fest/PartialDeep
 * cast) is needed anywhere.
 *
 * server.use(...)'s own handlers are prepended ahead of this one (that's msw's
 * documented behavior), so any test's own mocked handler for a specific URL always
 * matches first; this only ever runs for a request nothing more specific claimed.
 *
 * Allowed hosts (local infra — see allowed-network-hosts.ts, the same list test/setup.ts's
 * socket guard uses) get passthrough() — msw's documented way to let a request actually
 * reach the network, needed for every spec's own supertest traffic against the live
 * app under test. Everything else gets HttpResponse.error() — the one msw response
 * type that genuinely rejects the caller's fetch() (confirmed: ~100ms, no real network
 * touched, TypeError "fetch failed"), so a disallowed, unmocked request fails loudly
 * and immediately instead of reaching the real internet.
 */
export const mswLocalOnlyCatchAllHandler = http.all('*', ({ request }) => {
  const host = new URL(request.url).hostname;
  return isAllowedNetworkHost(host) ? passthrough() : HttpResponse.error();
});
