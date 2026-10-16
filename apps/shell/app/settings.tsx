import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProjectConfig } from '../src/config/ConfigContext';
import { appVersion } from '../src/lib/env';

const TAP_THRESHOLD = 5;
const TAP_WINDOW_MS = 2000;

export default function SettingsScreen() {
  const config = useProjectConfig();
  const router = useRouter();
  const [tapCount, setTapCount] = useState(0);
  const firstTapAt = useRef<number | null>(null);

  const handleVersionTap = () => {
    const now = Date.now();
    if (firstTapAt.current === null || now - firstTapAt.current > TAP_WINDOW_MS) {
      firstTapAt.current = now;
      setTapCount(1);
      return;
    }
    const next = tapCount + 1;
    setTapCount(next);
    if (next >= TAP_THRESHOLD) {
      firstTapAt.current = null;
      setTapCount(0);
      router.push('/debug');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>Настройки</Text>

      {config.privacyPolicyUrl ? (
        <Pressable
          style={styles.row}
          onPress={() => WebBrowser.openBrowserAsync(config.privacyPolicyUrl!)}
          accessibilityRole="button"
        >
          <Text style={styles.rowText}>Политика конфиденциальности</Text>
        </Pressable>
      ) : (
        <View style={styles.row}>
          <Text style={styles.rowTextMuted}>Политика конфиденциальности не указана</Text>
        </View>
      )}

      {config.trial ? (
        <View style={styles.trialNote}>
          <Text style={styles.trialNoteText}>
            Это пробная версия Mobilio. Полная версия: пуш-уведомления и публикация в App Store —
            подробности на mobilio.am
          </Text>
        </View>
      ) : null}

      <View style={styles.footer}>
        <Text style={styles.footerText}>Сделано в Mobilio</Text>
        <Pressable onPress={handleVersionTap} accessibilityRole="button">
          <Text style={styles.versionText}>Версия {appVersion}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF', padding: 20 },
  header: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 16 },
  row: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  rowText: { fontSize: 15, color: '#111827' },
  rowTextMuted: { fontSize: 15, color: '#9CA3AF' },
  trialNote: { marginTop: 16, padding: 12, borderRadius: 10, backgroundColor: '#F3F4F6' },
  trialNoteText: { fontSize: 13, color: '#4B5563' },
  footer: { marginTop: 'auto', alignItems: 'center', gap: 4, paddingVertical: 20 },
  footerText: { fontSize: 13, color: '#9CA3AF' },
  versionText: { fontSize: 12, color: '#D1D5DB' },
});
