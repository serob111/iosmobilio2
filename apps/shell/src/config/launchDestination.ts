export type LaunchDestination = '/onboarding' | '/main';

/**
 * '/main' (app/main.tsx) is the only screen that registers for push notifications (see
 * useRegisterPushOnMount) — so this decision also doubles as "when does that
 * registration happen": only once onboarding has actually been shown and finished, or
 * immediately if there's no onboarding to show at all.
 */
export function resolveLaunchDestination(params: {
  onboardingEnabled: boolean;
  hasSeenOnboarding: boolean;
}): LaunchDestination {
  const shouldOnboard = params.onboardingEnabled && !params.hasSeenOnboarding;
  return shouldOnboard ? '/onboarding' : '/main';
}
