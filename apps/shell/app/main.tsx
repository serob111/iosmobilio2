import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProjectConfig } from '../src/config/ConfigContext';
import { TabBar } from '../src/components/TabBar';
import { WebViewScreen } from '../src/components/WebViewScreen';
import { ContactsScreen } from '../src/components/ContactsScreen';

const TRIAL_BANNER_KEY = 'mobilio.trial_banner_last_shown';

export default function MainScreen() {
  const config = useProjectConfig();
  const router = useRouter();
  const [activeIndex, setActiveIndex] = useState(0);
  const [showTrialBanner, setShowTrialBanner] = useState(false);

  useEffect(() => {
    if (!config.trial) return;
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const lastShown = await AsyncStorage.getItem(TRIAL_BANNER_KEY);
      if (lastShown !== today) {
        setShowTrialBanner(true);
        await AsyncStorage.setItem(TRIAL_BANNER_KEY, today);
      }
    })();
  }, [config.trial]);

  const activeTab = config.tabs[activeIndex] ?? config.tabs[0];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {showTrialBanner ? (
        <View style={[styles.banner, { backgroundColor: config.theme.primary }]}>
          <Text style={styles.bannerText}>
            Пробная версия Mobilio. Полная версия с пуш-уведомлениями и публикацией в App Store:
            mobilio.am
          </Text>
          <Pressable onPress={() => setShowTrialBanner(false)} accessibilityRole="button">
            <Text style={styles.bannerClose}>×</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.content}>
        {activeTab.native === 'contacts' ? (
          <ContactsScreen contacts={config.nativeScreens?.contacts} primaryColor={config.theme.primary} />
        ) : (
          <WebViewScreen tab={activeTab} config={config} />
        )}
      </View>

      <TabBar
        tabs={config.tabs}
        activeIndex={activeIndex}
        primaryColor={config.theme.primary}
        onChange={setActiveIndex}
        onSettingsPress={() => router.push('/settings')}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { flex: 1 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  bannerText: { flex: 1, color: '#FFFFFF', fontSize: 12 },
  bannerClose: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', paddingHorizontal: 4 },
});
