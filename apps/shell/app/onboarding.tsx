import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProjectConfig } from '../src/config/ConfigContext';

const ONBOARDING_SEEN_KEY = 'mobilio.onboarding_seen_v1';

export default function OnboardingScreen() {
  const config = useProjectConfig();
  const router = useRouter();
  const slides = config.nativeScreens?.onboarding?.slides ?? [];
  const [index, setIndex] = useState(0);

  const finish = async () => {
    await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, '1');
    router.replace('/main');
  };

  if (slides.length === 0) {
    void finish();
    return null;
  }

  const slide = slides[index];
  const isLast = index === slides.length - 1;

  return (
    <SafeAreaView style={styles.container}>
      <Pressable onPress={finish} style={styles.skip} accessibilityRole="button">
        <Text style={styles.skipText}>Пропустить</Text>
      </Pressable>

      <View style={styles.content}>
        <Text style={styles.title}>{slide.title}</Text>
        <Text style={styles.text}>{slide.text}</Text>
      </View>

      <View style={styles.dots}>
        {slides.map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { backgroundColor: i === index ? config.theme.primary : '#E5E7EB' },
            ]}
          />
        ))}
      </View>

      <Pressable
        style={[styles.nextButton, { backgroundColor: config.theme.primary }]}
        onPress={() => (isLast ? finish() : setIndex((i) => i + 1))}
        accessibilityRole="button"
      >
        <Text style={styles.nextButtonText}>{isLast ? 'Начать' : 'Далее'}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  skip: { alignSelf: 'flex-end', padding: 16 },
  skipText: { color: '#6B7280', fontSize: 14 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center', color: '#111827' },
  text: { fontSize: 15, textAlign: 'center', color: '#6B7280' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 16 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  nextButton: { marginHorizontal: 24, marginBottom: 24, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  nextButtonText: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },
});
