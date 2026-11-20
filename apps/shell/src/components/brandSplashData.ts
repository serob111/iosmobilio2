import { File, Paths } from 'expo-file-system';
import { isStandaloneNative } from '../lib/env';
import { pushLog } from '../lib/debugLog';

export type BrandSplashData = {
  backgroundColor: string;
  imageUri?: string;
};

const DEFAULT_BACKGROUND = '#FFFFFF';

/**
 * Reads just enough of mobilio/config.json to paint the brand splash — not the full
 * ConfigContext/loadConfig flow, deliberately: BrandSplash has to render before the
 * rest of the app (it's what replaces the neutral native launch screen, see
 * plugins/withNeutralLaunchScreen.ts and _layout.tsx), so it can't wait on
 * ConfigContext's own async state. Reading the file twice (here and in loadConfig.ts)
 * is cheap — it's a few-hundred-byte local file, not a network call — and keeps this
 * independent of whether the full config later turns out to be invalid.
 */
export async function readBrandSplashData(): Promise<BrandSplashData> {
  if (!isStandaloneNative) return { backgroundColor: DEFAULT_BACKGROUND };

  try {
    const configFile = new File(Paths.bundle, 'mobilio', 'config.json');
    if (!configFile.exists) return { backgroundColor: DEFAULT_BACKGROUND };

    const raw = JSON.parse(await configFile.text()) as { theme?: { background?: string } };
    const backgroundColor = raw.theme?.background ?? DEFAULT_BACKGROUND;

    const splashFile = new File(Paths.bundle, 'mobilio', 'splash.png');
    return {
      backgroundColor,
      imageUri: splashFile.exists ? splashFile.uri : undefined,
    };
  } catch (error) {
    pushLog('warn', 'splash', 'Failed to read brand splash data', String(error));
    return { backgroundColor: DEFAULT_BACKGROUND };
  }
}
