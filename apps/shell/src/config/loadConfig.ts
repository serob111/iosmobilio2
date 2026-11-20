import { File, Paths } from 'expo-file-system';
import { parseProjectConfig, type ProjectConfig } from '@mobilio/config';
import { isStandaloneNative } from '../lib/env';
import { pushLog } from '../lib/debugLog';
import { demoConfig } from './demoConfig';

export type LoadConfigResult =
  | { status: 'ok'; config: ProjectConfig }
  | { status: 'missing' }
  | { status: 'invalid'; errors: string[] };

/**
 * `mobilio/config.json` is the *only* source of a client's config in a shipped app —
 * repack (packages/repacker) writes it into the .app bundle as a folder-reference
 * resource (withMobilioBundleResources, apps/shell/plugins) after swapping in that
 * client's name/bundleId/icons/splash. There is no fallback to a build-time-baked JS
 * value or a live API call: the old generated.config.json (baked into the JS bundle at
 * CI build time) and the /api/projects/:id remote fetch both predate the repack
 * pipeline and that endpoint no longer exists at all.
 */
export async function readBundledConfig(): Promise<LoadConfigResult> {
  try {
    const file = new File(Paths.bundle, 'mobilio', 'config.json');
    if (!file.exists) {
      pushLog('warn', 'config', 'No bundled mobilio/config.json found');
      return { status: 'missing' };
    }
    const raw = await file.text();
    const parsed = parseProjectConfig(JSON.parse(raw));
    if (!parsed.success) {
      pushLog('error', 'config', 'Bundled config failed validation', parsed.errors);
      return { status: 'invalid', errors: parsed.errors };
    }
    return { status: 'ok', config: parsed.data };
  } catch (error) {
    pushLog('error', 'config', 'Failed to read bundled config', String(error));
    return { status: 'invalid', errors: [String(error)] };
  }
}

/**
 * Expo Go and the web preview have no .app bundle to read mobilio/config.json from at
 * all — demoConfig is the only thing that makes sense there, not an error state.
 */
export async function loadProjectConfig(): Promise<LoadConfigResult> {
  if (!isStandaloneNative) {
    pushLog('info', 'config', 'Not a standalone native build — using demo config');
    return { status: 'ok', config: demoConfig };
  }
  return readBundledConfig();
}
