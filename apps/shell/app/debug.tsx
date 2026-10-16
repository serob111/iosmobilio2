import React, { useSyncExternalStore } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNetworkState } from 'expo-network';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useConfigState } from '../src/config/ConfigContext';
import { getLogSnapshot, subscribeToLog } from '../src/lib/debugLog';

export default function DebugScreen() {
  const state = useConfigState();
  const network = useNetworkState();
  const entries = useSyncExternalStore(subscribeToLog, getLogSnapshot);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Отладка</Text>

        <Text style={styles.sectionTitle}>Сеть</Text>
        <Text style={styles.mono}>
          isConnected: {String(network.isConnected)} · isInternetReachable:{' '}
          {String(network.isInternetReachable)} · type: {String(network.type)}
        </Text>

        <Text style={styles.sectionTitle}>Конфиг</Text>
        <Text style={styles.mono}>
          {state.status === 'ready' ? JSON.stringify(state.config, null, 2) : 'загрузка...'}
        </Text>

        <Text style={styles.sectionTitle}>Журнал ({entries.length})</Text>
        {entries
          .slice()
          .reverse()
          .map((entry, i) => (
            <View key={i} style={styles.logRow}>
              <Text style={[styles.logLevel, LEVEL_COLORS[entry.level]]}>{entry.level.toUpperCase()}</Text>
              <Text style={styles.mono}>
                [{entry.source}] {entry.message}
                {entry.data !== undefined ? ` ${JSON.stringify(entry.data)}` : ''}
              </Text>
            </View>
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const LEVEL_COLORS: Record<string, { color: string }> = {
  info: { color: '#2563EB' },
  warn: { color: '#D97706' },
  error: { color: '#DC2626' },
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { padding: 16, gap: 8 },
  heading: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '600', marginTop: 16, color: '#111827' },
  mono: { fontFamily: 'Courier', fontSize: 11, color: '#374151' },
  logRow: { marginTop: 4 },
  logLevel: { fontSize: 10, fontWeight: '700' },
});
