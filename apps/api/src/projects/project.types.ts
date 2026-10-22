import type { ProjectConfig } from '@mobilio/config';

export interface ProjectInfo {
  id: string;
  name: string;
  sourceUrl: string;
  config: ProjectConfig;
  configVersion: number;
}

declare module 'express' {
  interface Request {
    /** Set by ProjectGuard once it has verified the project exists within the org in the path. */
    project?: ProjectInfo;
  }
}
