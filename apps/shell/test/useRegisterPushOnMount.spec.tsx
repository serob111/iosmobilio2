import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ProjectConfig } from '@mobilio/config';

// react-test-renderer's act() warns without this — it's how React distinguishes test
// renders (where effects should flush synchronously) from production ones.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockRegister = vi.hoisted(() => vi.fn());
vi.mock('../src/notifications/registerPush', () => ({
  maybeRegisterForPushNotifications: mockRegister,
}));

const { useRegisterPushOnMount } = await import('../src/notifications/useRegisterPushOnMount');

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    id: 'p1',
    name: 'Test',
    slug: 'test',
    bundleId: 'am.mobilio.t.p1',
    source: { type: 'url', url: 'https://example.com' },
    theme: { primary: '#2563EB', background: '#FFFFFF', statusBar: 'dark' },
    tabs: [{ title: 'Home', icon: 'home', path: '/' }],
    features: { offline: true, share: true, deepLinks: false, pullToRefresh: true, push: true },
    allowedDomains: [],
    trial: true,
    ...overrides,
  };
}

// A bare host component — no View/Text/native modules — so this renders with nothing
// beyond react-test-renderer's own fake host, matching how useRegisterPushOnMount is
// actually used (a hook called from inside app/main.tsx, not a visual component).
function Host({ config }: { config: ProjectConfig }) {
  useRegisterPushOnMount(config);
  return null;
}

describe('useRegisterPushOnMount', () => {
  beforeEach(() => {
    mockRegister.mockClear();
  });

  it('registers for push once, on mount, with the given config', async () => {
    const config = makeConfig();
    await act(async () => {
      create(<Host config={config} />);
    });
    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect(mockRegister).toHaveBeenCalledWith(config);
  });

  it('does not re-register on a re-render that keeps the same config reference', async () => {
    const config = makeConfig();
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<Host config={config} />);
    });
    await act(async () => {
      renderer!.update(<Host config={config} />);
    });
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });
});
