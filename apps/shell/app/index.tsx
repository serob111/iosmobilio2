import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useConfigState } from '../src/config/ConfigContext';

const ONBOARDING_SEEN_KEY = 'mobilio.onboarding_seen_v1';

export default function IndexGate() {
  const state = useConfigState();
  const [destination, setDestination] = useState<'/onboarding' | '/main' | null>(null);
  const onboardingEnabled =
    state.status === 'ready' && Boolean(state.config.nativeScreens?.onboarding?.enabled);

  useEffect(() => {
    if (state.status !== 'ready') return;
    let cancelled = false;
    (async () => {
      const seen = await AsyncStorage.getItem(ONBOARDING_SEEN_KEY);
      const shouldOnboard = onboardingEnabled && !seen;
      if (!cancelled) setDestination(shouldOnboard ? '/onboarding' : '/main');
    })();
    return () => {
      cancelled = true;
    };
  }, [state.status, onboardingEnabled]);

  if (destination === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return <Redirect href={destination} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
