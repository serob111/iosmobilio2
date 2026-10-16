import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** True when running inside the Expo Go client app (not a standalone build). */
export const isExpoGo = Constants.appOwnership === 'expo';

export const isWeb = Platform.OS === 'web';

/** True for a standalone native build (the real target: template + repacked .ipa). */
export const isStandaloneNative = !isExpoGo && !isWeb;

export const apiBaseUrl =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

export const appVersion = Constants.expoConfig?.version ?? '0.0.0';
