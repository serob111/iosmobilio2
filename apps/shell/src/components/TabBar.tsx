import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ProjectConfig } from '@mobilio/config';

type IoniconName = keyof typeof Ionicons.glyphMap;

const ICON_MAP: Record<string, { active: IoniconName; inactive: IoniconName }> = {
  home: { active: 'home', inactive: 'home-outline' },
  grid: { active: 'grid', inactive: 'grid-outline' },
  location: { active: 'location', inactive: 'location-outline' },
  cart: { active: 'cart', inactive: 'cart-outline' },
  person: { active: 'person', inactive: 'person-outline' },
  search: { active: 'search', inactive: 'search-outline' },
  heart: { active: 'heart', inactive: 'heart-outline' },
  info: { active: 'information-circle', inactive: 'information-circle-outline' },
  chat: { active: 'chatbubble', inactive: 'chatbubble-outline' },
};

function resolveIcon(icon: string, active: boolean): IoniconName {
  const entry = ICON_MAP[icon];
  if (!entry) return active ? 'ellipse' : 'ellipse-outline';
  return active ? entry.active : entry.inactive;
}

type Props = {
  tabs: ProjectConfig['tabs'];
  activeIndex: number;
  primaryColor: string;
  onChange: (index: number) => void;
  onSettingsPress: () => void;
};

export function TabBar({ tabs, activeIndex, primaryColor, onChange, onSettingsPress }: Props) {
  return (
    <View style={styles.container}>
      {tabs.map((tab, index) => {
        const active = index === activeIndex;
        const color = active ? primaryColor : '#9CA3AF';
        return (
          <Pressable
            key={`${tab.title}-${index}`}
            style={styles.item}
            onPress={() => onChange(index)}
            accessibilityRole="button"
            accessibilityLabel={tab.title}
          >
            <Ionicons name={resolveIcon(tab.icon, active)} size={24} color={color} />
            <Text style={[styles.label, { color }]} numberOfLines={1}>
              {tab.title}
            </Text>
          </Pressable>
        );
      })}
      <Pressable
        style={styles.item}
        onPress={onSettingsPress}
        accessibilityRole="button"
        accessibilityLabel="Настройки"
      >
        <Ionicons name="settings-outline" size={24} color="#9CA3AF" />
        <Text style={[styles.label, { color: '#9CA3AF' }]}>Настройки</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    paddingTop: 8,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingBottom: 6,
  },
  label: {
    fontSize: 11,
  },
});
