import type { ConfigContext, ExpoConfig } from 'expo/config';
import fs from 'fs';

type ProjectOverrides = {
  name: string;
  slug: string;
  scheme: string;
  bundleIdentifier: string;
  splashBackgroundColor: string;
  icon?: string;
};

/**
 * In CI, CONFIG_PATH points at the project's config.json (downloaded from apps/web) and
 * ICON_PATH at its icon.png — this is what lets one shell template become each user's
 * uniquely-named, uniquely-identified app without hand-editing anything per build.
 * Without CONFIG_PATH (local dev / Expo Go), this returns null and nothing changes.
 */
function loadProjectOverrides(): ProjectOverrides | null {
  const configPath = process.env.CONFIG_PATH;
  if (!configPath) return null;
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw) as {
      name: string;
      slug: string;
      bundleId: string;
      theme?: { background?: string };
    };
    const iconPath = process.env.ICON_PATH;
    return {
      name: config.name,
      slug: config.slug,
      scheme: config.slug,
      bundleIdentifier: config.bundleId,
      splashBackgroundColor: config.theme?.background ?? '#FFFFFF',
      icon: iconPath && fs.existsSync(iconPath) ? iconPath : undefined,
    };
  } catch {
    return null;
  }
}

export default ({ config }: ConfigContext) => {
  const overrides = loadProjectOverrides();

  // Cast (not annotate) the return: newArchEnabled and some other valid app-config
  // fields lag behind in the published ExpoConfig type, and annotating the function's
  // return type instead would trigger excess-property errors on every one of them.
  return {
    ...config,
    name: overrides?.name ?? 'Mobilio',
    slug: overrides?.slug ?? 'mobilio-shell',
    scheme: overrides?.scheme ?? 'mobilio',
    version: '1.0.0',
    orientation: 'portrait',
    icon: overrides?.icon ?? './assets/icon.png',
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      bundleIdentifier: overrides?.bundleIdentifier ?? 'am.mobilio.trial.demo',
    },
    android: {
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      favicon: './assets/favicon.png',
      bundler: 'metro',
    },
    plugins: [
      'expo-router',
      'expo-status-bar',
      'expo-web-browser',
      [
        'expo-splash-screen',
        {
          backgroundColor: overrides?.splashBackgroundColor ?? '#FFFFFF',
          image: './assets/splash-icon.png',
        },
      ],
    ],
  } as ExpoConfig;
};
