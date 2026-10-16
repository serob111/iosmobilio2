import { File, Paths } from 'expo-file-system';
import { parseProjectConfig, type ProjectConfig } from '@mobilio/config';
import { apiBaseUrl, isStandaloneNative } from '../lib/env';
import { pushLog } from '../lib/debugLog';
import { demoConfig } from './demoConfig';
import generatedConfigJson from './generated.config.json';

/**
 * CI writes the project's real config here before building, and the shell statically
 * imports it — Metro bundles it like any JSON import, no native file-system plumbing
 * needed. Ships as `{}` in the repo; non-empty only in a build CI produced.
 */
function readGeneratedConfig(): ProjectConfig | null {
  if (!generatedConfigJson || Object.keys(generatedConfigJson).length === 0) return null;
  const parsed = parseProjectConfig(generatedConfigJson);
  if (!parsed.success) {
    pushLog('error', 'config', 'generated.config.json failed validation', parsed.errors);
    return null;
  }
  return parsed.data;
}

/**
 * Reads `mobilio/config.json` from the app bundle via expo-file-system. Superseded by
 * `readGeneratedConfig` above (the real CI pipeline bakes config into the JS bundle at
 * build time instead) — kept only as a lower-priority fallback, not currently exercised
 * by anything that writes to this path.
 */
async function readBundledConfig(): Promise<ProjectConfig | null> {
  if (!isStandaloneNative) return null;
  try {
    const file = new File(Paths.bundle, 'mobilio', 'config.json');
    if (!file.exists) {
      pushLog('warn', 'config', 'No bundled mobilio/config.json found');
      return null;
    }
    const raw = await file.text();
    const parsed = parseProjectConfig(JSON.parse(raw));
    if (!parsed.success) {
      pushLog('error', 'config', 'Bundled config failed validation', parsed.errors);
      return null;
    }
    return parsed.data;
  } catch (error) {
    pushLog('error', 'config', 'Failed to read bundled config', String(error));
    return null;
  }
}

async function fetchRemoteConfig(projectId: string): Promise<ProjectConfig | null> {
  try {
    const res = await fetch(`${apiBaseUrl}/api/projects/${projectId}`);
    if (!res.ok) {
      pushLog('warn', 'config', `Remote config fetch failed with status ${res.status}`);
      return null;
    }
    const json = await res.json();
    const parsed = parseProjectConfig(json);
    if (!parsed.success) {
      pushLog('error', 'config', 'Remote config failed validation', parsed.errors);
      return null;
    }
    return parsed.data;
  } catch (error) {
    pushLog('warn', 'config', 'Remote config fetch threw', String(error));
    return null;
  }
}

export function getProjectIdFromParams(params: Record<string, unknown>): string | null {
  const value = params.project;
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

export async function loadProjectConfig(projectId: string | null): Promise<ProjectConfig> {
  const generated = readGeneratedConfig();
  if (generated) {
    pushLog('info', 'config', 'Loaded config from generated.config.json');
    return generated;
  }

  const bundled = await readBundledConfig();
  if (bundled) {
    pushLog('info', 'config', 'Loaded config from app bundle');
    return bundled;
  }

  if (projectId) {
    const remote = await fetchRemoteConfig(projectId);
    if (remote) {
      pushLog('info', 'config', `Loaded config for project ${projectId} from API`);
      return remote;
    }
  }

  pushLog('info', 'config', 'Falling back to demo config');
  return demoConfig;
}
