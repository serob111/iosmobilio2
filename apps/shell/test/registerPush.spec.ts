import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ProjectConfig } from '@mobilio/config';

const mockEnv = vi.hoisted(() => ({ isStandaloneNative: true }));
vi.mock('../src/lib/env', () => mockEnv);

const mockPushLog = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/debugLog', () => ({ pushLog: mockPushLog }));

const mockNotifications = vi.hoisted(() => ({
  requestPermissionsAsync: vi.fn(),
  getDevicePushTokenAsync: vi.fn(),
}));
vi.mock('expo-notifications', () => mockNotifications);

function configWith(push: boolean): ProjectConfig {
  return {
    id: 'p1',
    name: 'Test',
    slug: 'test',
    bundleId: 'am.mobilio.t.p1',
    source: { type: 'url', url: 'https://example.com' },
    theme: { primary: '#2563EB', background: '#FFFFFF', statusBar: 'dark' },
    tabs: [{ title: 'Home', icon: 'home', path: '/' }],
    features: { offline: true, share: true, deepLinks: false, pullToRefresh: true, push },
    allowedDomains: [],
    trial: true,
  };
}

describe('maybeRegisterForPushNotifications', () => {
  beforeEach(() => {
    mockEnv.isStandaloneNative = true;
    mockPushLog.mockClear();
    mockNotifications.requestPermissionsAsync.mockReset();
    mockNotifications.getDevicePushTokenAsync.mockReset();
  });

  it('never calls the notifications API when config.features.push is false', async () => {
    const { maybeRegisterForPushNotifications } = await import('../src/notifications/registerPush');
    const result = await maybeRegisterForPushNotifications(configWith(false));
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('never calls the notifications API outside a standalone native build, even with push enabled', async () => {
    mockEnv.isStandaloneNative = false;
    const { maybeRegisterForPushNotifications } = await import('../src/notifications/registerPush');
    const result = await maybeRegisterForPushNotifications(configWith(true));
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('returns the raw APNs device token (not an Expo push token) when permission is granted', async () => {
    mockNotifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockNotifications.getDevicePushTokenAsync.mockResolvedValue({ type: 'ios', data: 'deadbeef-apns-token' });
    const { maybeRegisterForPushNotifications } = await import('../src/notifications/registerPush');
    const result = await maybeRegisterForPushNotifications(configWith(true));
    expect(mockNotifications.getDevicePushTokenAsync).toHaveBeenCalled();
    expect(result).toEqual({ token: 'deadbeef-apns-token', platform: 'ios' });
  });

  it('does not fetch a token when permission is denied', async () => {
    mockNotifications.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });
    const { maybeRegisterForPushNotifications } = await import('../src/notifications/registerPush');
    const result = await maybeRegisterForPushNotifications(configWith(true));
    expect(mockNotifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('returns undefined for a non-ios device push token type instead of mislabeling it', async () => {
    mockNotifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockNotifications.getDevicePushTokenAsync.mockResolvedValue({ type: 'android', data: 'fcm-token' });
    const { maybeRegisterForPushNotifications } = await import('../src/notifications/registerPush');
    const result = await maybeRegisterForPushNotifications(configWith(true));
    expect(result).toBeUndefined();
  });

  it('does not throw when the notifications API itself throws', async () => {
    mockNotifications.requestPermissionsAsync.mockRejectedValue(new Error('native module unavailable'));
    const { maybeRegisterForPushNotifications } = await import('../src/notifications/registerPush');
    await expect(maybeRegisterForPushNotifications(configWith(true))).resolves.toBeUndefined();
  });
});
