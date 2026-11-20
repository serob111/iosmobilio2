import { describe, expect, it } from 'vitest';
import { resolveLaunchDestination } from '../src/config/launchDestination';

describe('resolveLaunchDestination', () => {
  it('goes to onboarding first when it is enabled and has not been seen yet', () => {
    const result = resolveLaunchDestination({ onboardingEnabled: true, hasSeenOnboarding: false });
    expect(result).toBe('/onboarding');
  });

  it('goes straight to main — the first screen after onboarding — when onboarding is disabled', () => {
    const result = resolveLaunchDestination({ onboardingEnabled: false, hasSeenOnboarding: false });
    expect(result).toBe('/main');
  });

  it('goes straight to main when onboarding is enabled but has already been seen', () => {
    const result = resolveLaunchDestination({ onboardingEnabled: true, hasSeenOnboarding: true });
    expect(result).toBe('/main');
  });
});
