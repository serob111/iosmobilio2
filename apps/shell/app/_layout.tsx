import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConfigProvider } from '../src/config/ConfigContext';

// Keeps the neutral native launch screen up until BrandSplash (app/index.tsx) has read
// mobilio/config.json and has something brand-correct to show in its place — without
// this, expo-splash-screen's default behavior hides the native screen as soon as the
// first JS frame renders, which would flash neutral-then-blank before BrandSplash's own
// async read resolves. Must run at module scope, before the first render.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ConfigProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }} />
      </ConfigProvider>
    </SafeAreaProvider>
  );
}
