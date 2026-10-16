import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import type { ProjectConfig } from '@mobilio/config';

type Props = {
  contacts: NonNullable<ProjectConfig['nativeScreens']>['contacts'];
  primaryColor: string;
};

export function ContactsScreen({ contacts, primaryColor }: Props) {
  if (!contacts) {
    return (
      <View style={styles.container}>
        <Text style={styles.empty}>Контакты не указаны</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {contacts.phone ? (
        <Pressable style={styles.row} onPress={() => Linking.openURL(`tel:${contacts.phone}`)}>
          <Ionicons name="call-outline" size={22} color={primaryColor} />
          <Text style={styles.rowText}>{contacts.phone}</Text>
        </Pressable>
      ) : null}
      {contacts.address ? (
        <View style={styles.row}>
          <Ionicons name="location-outline" size={22} color={primaryColor} />
          <Text style={styles.rowText}>{contacts.address}</Text>
        </View>
      ) : null}
      {contacts.mapUrl ? (
        <Pressable style={styles.row} onPress={() => WebBrowser.openBrowserAsync(contacts.mapUrl!)}>
          <Ionicons name="map-outline" size={22} color={primaryColor} />
          <Text style={styles.rowText}>Открыть на карте</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    gap: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  rowText: {
    fontSize: 15,
    color: '#111827',
  },
  empty: {
    textAlign: 'center',
    color: '#6B7280',
    marginTop: 40,
  },
});
