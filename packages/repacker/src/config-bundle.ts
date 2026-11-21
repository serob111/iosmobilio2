import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseProjectConfig, type ProjectConfig } from '@mobilio/config';
import { RepackError } from './errors.js';

const MAX_CONFIG_SIZE_BYTES = 256 * 1024;

/**
 * Validates through the exact same validator apps/shell's loadConfig.ts runs at app
 * launch — a mobilio/config.json that fails validation would make the repacked .app
 * unusable from the moment it starts (loadConfig.ts routes straight to ErrorScreen),
 * so repack() rejects it here, before signing or shipping anything.
 */
export function validateProjectConfig(rawConfig: unknown): ProjectConfig {
  const result = parseProjectConfig(rawConfig);
  if (!result.success) {
    throw new RepackError('INVALID_CONFIG', `project config failed validation: ${result.errors.join('; ')}`);
  }
  return result.data;
}

/**
 * Writes mobilio/config.json into the already-extracted .app at mobilioDir — see
 * withMobilioBundleResources.js for why that exact folder name/location (nested
 * under <projectName>/mobilio at the .app root) is load-bearing, not arbitrary.
 * Bounded at 256KB: this gets read into memory and JSON.parse'd on every app launch
 * (loadConfig.ts), so an unbounded size is its own kind of misconfiguration this
 * should catch rather than ship.
 */
export async function writeConfigJson(mobilioDir: string, config: ProjectConfig): Promise<void> {
  const serialized = JSON.stringify(config);
  const sizeBytes = Buffer.byteLength(serialized, 'utf8');
  if (sizeBytes > MAX_CONFIG_SIZE_BYTES) {
    throw new RepackError(
      'INVALID_CONFIG',
      `config.json is ${sizeBytes} bytes, exceeding the ${MAX_CONFIG_SIZE_BYTES}-byte limit`,
    );
  }
  await writeFile(join(mobilioDir, 'config.json'), serialized, 'utf8');
}
