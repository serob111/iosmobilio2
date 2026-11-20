import React, { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useConfigState } from '../src/config/ConfigContext';
import { BrandSplash } from '../src/components/BrandSplash';
import { ErrorScreen } from '../src/components/ErrorScreen';

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

  if (state.status === 'error') {
    return <ErrorScreen reason={state.reason} />;
  }

  if (destination === null) {
    return <BrandSplash />;
  }

  return <Redirect href={destination} />;
}
