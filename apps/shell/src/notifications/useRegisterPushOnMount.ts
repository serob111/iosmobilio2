import { useEffect } from 'react';
import type { ProjectConfig } from '@mobilio/config';
import { maybeRegisterForPushNotifications } from './registerPush';

/**
 * Only ever mounted from app/main.tsx — the one screen every first run reaches right
 * after onboarding, whether via onboarding.tsx's own finish() (onboarding shown) or
 * directly from index.tsx's redirect (onboarding disabled or already seen). Mounting
 * this from app/_layout.tsx or app/onboarding.tsx instead would prompt for push
 * permission before the user has seen anything of the app.
 */
export function useRegisterPushOnMount(config: ProjectConfig): void {
  useEffect(() => {
    void maybeRegisterForPushNotifications(config);
  }, [config]);
}
