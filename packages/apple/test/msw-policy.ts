import { http, HttpResponse, passthrough } from 'msw';
import { isAllowedNetworkHost } from './allowed-network-hosts.js';

// Mirrors apps/api/test/msw-policy.ts — see that file's own comment for why this is a
// catch-all handler (registered as setupServer()'s own initial handler, see
// mocks/server.ts) rather than an onUnhandledRequest/onUnhandledFrame option: msw@3
// doesn't have onUnhandledRequest at all, and its onUnhandledFrame replacement doesn't
// actually reject the caller's fetch() the way the old option was documented to.
export const mswLocalOnlyCatchAllHandler = http.all('*', ({ request }) => {
  const host = new URL(request.url).hostname;
  return isAllowedNetworkHost(host) ? passthrough() : HttpResponse.error();
});
