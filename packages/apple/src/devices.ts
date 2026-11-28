import type { AppStoreConnectClient } from './client.js';

type DeviceResource = {
  type: 'devices';
  id: string;
  attributes: { status: 'ENABLED' | 'DISABLED' };
};

type DevicesListResponse = {
  data: DeviceResource[];
  links?: { next?: string };
};

/**
 * Device registration (turning a UDID a client hands over via .mobileconfig into a
 * registered device on our account) is explicitly out of scope for this phase — see
 * ensureAdHocProfile's own doc comment, which takes an already-registered deviceIds
 * list rather than doing any registration itself. This is what supplies that list:
 * every currently ENABLED device on our one shared App Store Connect account, which is
 * exactly the set Apple will actually let an Ad Hoc profile include. Paginates through
 * `links.next` since an account can have up to Apple's own cap (100/year) worth of
 * devices, more than a single page.
 */
export async function listRegisteredDeviceIds(client: AppStoreConnectClient): Promise<string[]> {
  const ids: string[] = [];
  let path = 'devices';
  let query: Record<string, string> | undefined = { 'filter[status]': 'ENABLED', limit: '200' };

  for (;;) {
    const response = await client.request<DevicesListResponse>('GET', path, query ? { query } : undefined);
    ids.push(...response.data.map((device) => device.id));
    const next = response.links?.next;
    if (!next) break;
    path = next;
    query = undefined; // the next link already carries its own query string
  }

  return ids;
}
