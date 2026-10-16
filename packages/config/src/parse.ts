import { ProjectConfigSchema, type ProjectConfig } from './schema';

export type ParseProjectConfigResult =
  | { success: true; data: ProjectConfig }
  | { success: false; errors: string[] };

/** Validates raw data against the Mobilio project config schema, returning Russian error messages. */
export function parseProjectConfig(data: unknown): ParseProjectConfigResult {
  const result = ProjectConfigSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return { success: false, errors };
}
