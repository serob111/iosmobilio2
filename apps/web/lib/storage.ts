import crypto from 'crypto';
import path from 'path';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import type { ProjectConfig } from '@mobilio/config';

const PROJECT_ID_PATTERN = /^p_[a-z0-9]+$/;

const DATA_ROOT = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), '..', '..', 'data', 'projects');

export type BuildStatus = {
  status: 'queued' | 'building' | 'success' | 'failed';
  runId?: number;
  workflowRunUrl?: string;
  dispatchedAt?: number;
  finishedAt?: number;
  error?: string;
};

function assertValidId(id: string): void {
  if (!PROJECT_ID_PATTERN.test(id)) {
    throw new Error('Некорректный идентификатор проекта');
  }
}

function projectDir(id: string): string {
  assertValidId(id);
  return path.join(DATA_ROOT, id);
}

export function createProjectId(): string {
  return `p_${crypto.randomBytes(6).toString('hex')}`;
}

async function ensureProjectDir(id: string): Promise<string> {
  const dir = projectDir(id);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function readConfig(id: string): Promise<ProjectConfig> {
  const raw = await readFile(path.join(projectDir(id), 'config.json'), 'utf8');
  return JSON.parse(raw) as ProjectConfig;
}

export async function writeConfig(id: string, config: ProjectConfig): Promise<void> {
  const dir = await ensureProjectDir(id);
  await writeFile(path.join(dir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
}

export async function projectExists(id: string): Promise<boolean> {
  try {
    await readConfig(id);
    return true;
  } catch {
    return false;
  }
}

export async function readIcon(id: string): Promise<Buffer> {
  return readFile(path.join(projectDir(id), 'icon.png'));
}

export async function writeIcon(id: string, buffer: Buffer): Promise<void> {
  const dir = await ensureProjectDir(id);
  await writeFile(path.join(dir, 'icon.png'), buffer);
}

export async function readBuildStatus(id: string): Promise<BuildStatus | null> {
  try {
    const raw = await readFile(path.join(projectDir(id), 'build.json'), 'utf8');
    return JSON.parse(raw) as BuildStatus;
  } catch {
    return null;
  }
}

export async function writeBuildStatus(id: string, status: BuildStatus): Promise<void> {
  const dir = await ensureProjectDir(id);
  await writeFile(path.join(dir, 'build.json'), JSON.stringify(status, null, 2), 'utf8');
}

export function ipaPath(id: string): string {
  return path.join(projectDir(id), 'app.ipa');
}

export async function hasIpa(id: string): Promise<boolean> {
  try {
    await stat(ipaPath(id));
    return true;
  } catch {
    return false;
  }
}

export async function writeIpa(id: string, buffer: Buffer): Promise<void> {
  const dir = await ensureProjectDir(id);
  await writeFile(path.join(dir, 'app.ipa'), buffer);
}
