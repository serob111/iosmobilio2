import React, { createContext, useContext, useEffect, useState } from 'react';
import { useGlobalSearchParams } from 'expo-router';
import type { ProjectConfig } from '@mobilio/config';
import { getProjectIdFromParams, loadProjectConfig } from './loadConfig';

export type ConfigState =
  | { status: 'loading' }
  | { status: 'ready'; config: ProjectConfig };

const ConfigCtx = createContext<ConfigState>({ status: 'loading' });

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const params = useGlobalSearchParams();
  const projectId = getProjectIdFromParams(params);
  const [state, setState] = useState<ConfigState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    loadProjectConfig(projectId).then((config) => {
      if (!cancelled) setState({ status: 'ready', config });
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return <ConfigCtx.Provider value={state}>{children}</ConfigCtx.Provider>;
}

export function useConfigState(): ConfigState {
  return useContext(ConfigCtx);
}

/** Throws if called before the config has finished loading — only use below the loading gate. */
export function useProjectConfig(): ProjectConfig {
  const state = useContext(ConfigCtx);
  if (state.status !== 'ready') {
    throw new Error('useProjectConfig called before config finished loading');
  }
  return state.config;
}
