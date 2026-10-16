import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  onRetry: () => void;
  primaryColor: string;
  title?: string;
  subtitle?: string;
};

export function OfflineScreen({
  onRetry,
  primaryColor,
  title = 'Нет соединения',
  subtitle = 'Проверьте интернет-подключение и попробуйте снова',
}: Props) {
  return (
    <View style={styles.container}>
      <Ionicons name="cloud-offline-outline" size={64} color="#9CA3AF" />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      <Pressable
        style={[styles.button, { backgroundColor: primaryColor }]}
        onPress={onRetry}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>Повторить</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
  button: {
    marginTop: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },
});
