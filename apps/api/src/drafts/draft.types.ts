import type { ProjectConfig } from '@mobilio/config';

export interface DraftInfo {
  id: string;
  name: string;
  sourceUrl: string;
  config: ProjectConfig;
  configVersion: number;
  expiresAt: Date;
}

declare module 'express' {
  interface Request {
    /** Set by DraftGuard once it has resolved the claim-token cookie to a live draft row. */
    draft?: DraftInfo;
    draftTokenHash?: string;
  }
}
