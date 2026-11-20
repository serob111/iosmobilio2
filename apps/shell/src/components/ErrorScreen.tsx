import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Shown when mobilio/config.json is missing or fails validation in a standalone
 * native build — there is nothing else to fall back to (see loadConfig.ts), so this is
 * the only thing the app can render. Not expected in a correctly repacked .ipa; if a
 * real user ever sees this, repack itself produced a broken bundle.
 */
export function ErrorScreen({ reason }: { reason: 'missing' | 'invalid' }): React.ReactElement {
  const message =
    reason === 'missing'
      ? 'Файл конфигурации приложения не найден.'
      : 'Файл конфигурации приложения повреждён.';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Не удалось запустить приложение</Text>
        <Text style={styles.text}>{message}</Text>
        <Text style={styles.hint}>Переустановите приложение или обратитесь в поддержку mobilio.am.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  title: { fontSize: 18, fontWeight: '700', textAlign: 'center', color: '#111827' },
  text: { fontSize: 15, textAlign: 'center', color: '#374151' },
  hint: { fontSize: 13, textAlign: 'center', color: '#6B7280', marginTop: 8 },
});
