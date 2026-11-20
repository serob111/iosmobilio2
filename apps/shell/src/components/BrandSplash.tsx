import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { readBrandSplashData, type BrandSplashData } from './brandSplashData';

/**
 * Covers the gap between the native launch screen (neutral — see
 * plugins/withNeutralLaunchScreen.ts) hiding and the real app content mounting. Reads
 * its own background color/splash image directly from mobilio/config.json (not through
 * ConfigContext — see brandSplashData.ts for why) and hides the native splash itself
 * the moment it has something to show, so there's no neutral-then-blank flash.
 */
export function BrandSplash(): React.ReactElement | null {
  const [data, setData] = useState<BrandSplashData | null>(null);

  useEffect(() => {
    let cancelled = false;
    readBrandSplashData().then((result) => {
      if (!cancelled) setData(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (data) {
      void SplashScreen.hideAsync();
    }
  }, [data]);

  if (!data) return null;

  return (
    <View style={[styles.container, { backgroundColor: data.backgroundColor }]}>
      {data.imageUri ? <Image source={{ uri: data.imageUri }} style={styles.image} resizeMode="contain" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: { width: 160, height: 160 },
});
