import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConfigProvider } from '../src/config/ConfigContext';

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
