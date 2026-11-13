import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Deliberately NOT mocking undici/fetch here (unlike safe-fetch.spec.ts) — this test
// needs a real socket to actually open, since the whole point is proving the
// connection-pinning behavior end-to-end rather than asserting on which mock got called.
// Only the DNS step itself is faked, so the test is deterministic rather than depending
// on a real external hostname.
const lookupMock = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

const { safeFetch } = await import('./safe-fetch.js');

describe('safeFetch DNS-rebinding resistance (real sockets, no fetch/Agent mocking)', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers
        .splice(0)
        .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
    lookupMock.mockReset();
  });

  function bind(address: string, label: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((_, res) => res.end(label));
      server.once('error', reject);
      server.listen(port, address, () => {
        servers.push(server);
        resolve();
      });
    });
  }

  /**
   * 127.0.0.0/8 is entirely loopback, not just 127.0.0.1 — binding two servers to two
   * different addresses within it on the *same* port stands in for two different hosts
   * a DNS answer could point at, without needing real multi-homed network access (DNS
   * resolves a hostname to an address, not a port, so the port has to match for this to
   * mean anything). Retries once with a fresh ephemeral port in the unlikely case
   * something else already holds it on one of the two addresses.
   */
  async function bindPair(): Promise<{
    port: number;
    correctAddress: string;
    decoyAddress: string;
  }> {
    const correctAddress = '127.0.0.1';
    const decoyAddress = '127.0.0.2';
    for (let attempt = 0; attempt < 3; attempt++) {
      const probe = http.createServer();
      const port = await new Promise<number>((resolve) => {
        probe.listen(0, correctAddress, () => resolve((probe.address() as AddressInfo).port));
      });
      await new Promise<void>((resolve) => probe.close(() => resolve()));
      try {
        await bind(correctAddress, 'correct-server', port);
        await bind(decoyAddress, 'decoy-server', port);
        return { port, correctAddress, decoyAddress };
      } catch {
        await Promise.all(
          servers
            .splice(0)
            .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
        );
      }
    }
    throw new Error('Could not bind a matching port on both loopback addresses after 3 attempts');
  }

  it('connects to the address validated at resolve time, not whatever a later lookup would return', async () => {
    const { port, correctAddress, decoyAddress } = await bindPair();

    let lookupCallCount = 0;
    lookupMock.mockImplementation(async () => {
      lookupCallCount += 1;
      // First call (safeFetch's own validation step) answers correctly; a hypothetical
      // second call — which would only happen if the pinned dispatcher were ignored and
      // the real connection re-resolved the hostname itself — answers with the decoy.
      const address = lookupCallCount === 1 ? correctAddress : decoyAddress;
      return [{ address, family: 4 }];
    });

    const result = await safeFetch(`http://rebinding-test.invalid:${port}/`, {
      maxBodyBytes: 1000,
      // rebinding-test.invalid never resolves for real (.invalid is reserved by RFC 2606
      // to never resolve) — if pinning were broken, this would fail the connection
      // outright rather than silently reaching the decoy, which is still a failure.
      allowAddressesForTesting: [correctAddress, decoyAddress],
      // A real test server can't bind privileged port 80 without root.
      allowAnyPortForTesting: true,
    });

    expect(result.body.toString()).toBe('correct-server');
    // The real connection never asked dns.lookup again — it reused what was already
    // validated. If the dispatcher were ignored, the connection layer would have to
    // resolve the hostname itself, which (via this same mock) would be a second call.
    expect(lookupCallCount).toBe(1);
  });
});
