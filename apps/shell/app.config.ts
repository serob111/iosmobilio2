import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withMobilioBundleResources } from './plugins/withMobilioBundleResources';
import { withMobilioIcons } from './plugins/withMobilioIcons';

/**
 * This is the *base* — one compiled shell, the same for every client (see
 * README/docs for the repack pipeline). Nothing here varies per project: name,
 * bundleIdentifier, scheme, icons and splash are all fixed, "neutral" values. Every
 * client-specific value (name, bundle id, icon, splash color/image, entitlements'
 * real aps-environment/associated-domains) is written by repack (packages/repacker)
 * directly into the already-*built* .app — never by this config, and never read from
 * CONFIG_PATH/ICON_PATH env vars (that CI-time-bake approach predates the repack
 * pipeline and no longer exists).
 */
export default ({ config }: ConfigContext) => {
  // Cast (not annotate) the return: newArchEnabled and some other valid app-config
  // fields lag behind in the published ExpoConfig type, and annotating the function's
  // return type instead would trigger excess-property errors on every one of them.
  return {
    ...config,
    name: 'Mobilio',
    slug: 'mobilio-shell',
    scheme: 'mobilio',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'am.mobilio.shell.base',
      // Template values — repack overwrites both with this client's real domains and
      // 'production' before signing (see packages/repacker's entitlements step). The
      // capability itself (Associated Domains, Push Notifications) still has to be
      // enabled on the App ID in Apple's portal per-client; packages/apple's
      // ensureBundleId does that.
      entitlements: {
        'aps-environment': 'development',
        'com.apple.developer.associated-domains': [],
      },
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
      'expo-notifications',
      withMobilioBundleResources,
      withMobilioIcons,
      [
        'expo-splash-screen',
        {
          // Neutral on purpose (see app/_layout.tsx's SplashScreen.preventAutoHideAsync
          // + src/components/BrandSplash.tsx) — no client color/logo belongs in the
          // native launch screen; the system default background shows for the instant
          // between process launch and BrandSplash's own first paint, which reads the
          // real color/image from mobilio/config.json/splash.png at runtime instead.
        },
      ],
    ],
  } as ExpoConfig;
};
