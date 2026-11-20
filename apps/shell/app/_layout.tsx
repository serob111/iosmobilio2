import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConfigProvider, useConfigState } from '../src/config/ConfigContext';
import { maybeRegisterForPushNotifications } from '../src/notifications/registerPush';

// Keeps the neutral native launch screen up until BrandSplash (app/index.tsx) has read
// mobilio/config.json and has something brand-correct to show in its place — without
// this, expo-splash-screen's default behavior hides the native screen as soon as the
// first JS frame renders, which would flash neutral-then-blank before BrandSplash's own
// async read resolves. Must run at module scope, before the first render.
void SplashScreen.preventAutoHideAsync();

/** Fires once the config has actually loaded — see registerPush.ts for the config.features.push gate. */
function PushRegistrationGate(): null {
  const state = useConfigState();
  useEffect(() => {
    if (state.status === 'ready') void maybeRegisterForPushNotifications(state.config);
  }, [state]);
  return null;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ConfigProvider>
        <PushRegistrationGate />
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }} />
      </ConfigProvider>
    </SafeAreaProvider>
  );
}
