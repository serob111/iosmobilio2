import * as Notifications from 'expo-notifications';
import type { ProjectConfig } from '@mobilio/config';
import { isStandaloneNative } from '../lib/env';
import { pushLog } from '../lib/debugLog';

export type PushRegistration = { token: string; platform: 'ios' };

/**
 * The native module and its Info.plist/entitlements capability ship in every build —
 * app.config.ts's plugin list is the same for every client, there's no code here that
 * depends on bundle id — only this JS-side call is conditional. A client without
 * config.features.push enabled never prompts for permission or registers with APNs.
 *
 * Gets the raw APNs device token (getDevicePushTokenAsync), not an Expo push token —
 * we send notifications straight to APNs from our own server, keyed by each app's own
 * bundle id, not through Expo's push service. Sending the token to the backend is a
 * separate, later step; this only returns it to the caller.
 */
export async function maybeRegisterForPushNotifications(
  config: ProjectConfig,
): Promise<PushRegistration | undefined> {
  if (!config.features.push || !isStandaloneNative) return undefined;
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      pushLog('warn', 'push', 'Push permission not granted');
      return undefined;
    }
    const devicePushToken = await Notifications.getDevicePushTokenAsync();
    if (devicePushToken.type !== 'ios') {
      pushLog('warn', 'push', `Unexpected device push token type: ${devicePushToken.type}`);
      return undefined;
    }
    pushLog('info', 'push', 'Registered for push notifications');
    return { token: devicePushToken.data, platform: 'ios' };
  } catch (error) {
    pushLog('error', 'push', 'Push registration failed', String(error));
    return undefined;
  }
}
