import { File, Paths } from 'expo-file-system';
import { parseProjectConfig } from '@mobilio/config';
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
 * is cheap — it's a few-hundred-byte local file, not a network call.
 *
 * Still runs the JSON through parseProjectConfig (the same validator loadConfig.ts
 * uses), rather than trusting theme.background straight out of the raw JSON — a
 * malformed or non-hex color here would otherwise reach a native View's
 * backgroundColor style unchecked.
 */
export async function readBrandSplashData(): Promise<BrandSplashData> {
  if (!isStandaloneNative) return { backgroundColor: DEFAULT_BACKGROUND };

  try {
    const configFile = new File(Paths.bundle, 'mobilio', 'config.json');
    if (!configFile.exists) return { backgroundColor: DEFAULT_BACKGROUND };

    const parsed = parseProjectConfig(JSON.parse(await configFile.text()));
    if (!parsed.success) {
      pushLog('warn', 'splash', 'Bundled config failed validation, using default splash background', parsed.errors);
      return { backgroundColor: DEFAULT_BACKGROUND };
    }

    const splashFile = new File(Paths.bundle, 'mobilio', 'splash.png');
    return {
      backgroundColor: parsed.data.theme.background,
      imageUri: splashFile.exists ? splashFile.uri : undefined,
    };
  } catch (error) {
    pushLog('warn', 'splash', 'Failed to read brand splash data', String(error));
    return { backgroundColor: DEFAULT_BACKGROUND };
  }
}
