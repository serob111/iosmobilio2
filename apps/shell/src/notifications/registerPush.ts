import * as Notifications from 'expo-notifications';
import type { ProjectConfig } from '@mobilio/config';
import { isStandaloneNative } from '../lib/env';
import { pushLog } from '../lib/debugLog';

/**
 * The native module and its Info.plist/entitlements capability ship in every build —
 * app.config.ts's plugin list is the same for every client, there's no code here that
 * depends on bundle id — only this JS-side call is conditional. A client without
 * config.features.push enabled never prompts for permission or registers with APNs.
 */
export async function maybeRegisterForPushNotifications(config: ProjectConfig): Promise<void> {
  if (!config.features.push || !isStandaloneNative) return;
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      pushLog('warn', 'push', 'Push permission not granted');
      return;
    }
    const token = await Notifications.getExpoPushTokenAsync();
    pushLog('info', 'push', 'Registered for push notifications', token.data);
  } catch (error) {
    pushLog('error', 'push', 'Push registration failed', String(error));
  }
}
