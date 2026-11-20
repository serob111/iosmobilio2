import React, { createContext, useContext, useEffect, useState } from 'react';
import type { ProjectConfig } from '@mobilio/config';
import { loadProjectConfig, type LoadConfigResult } from './loadConfig';

export type ConfigState =
  | { status: 'loading' }
  | { status: 'ready'; config: ProjectConfig }
  | { status: 'error'; reason: 'missing' | 'invalid'; errors?: string[] };

const ConfigCtx = createContext<ConfigState>({ status: 'loading' });

function toConfigState(result: LoadConfigResult): ConfigState {
  if (result.status === 'ok') return { status: 'ready', config: result.config };
  return result.status === 'missing'
    ? { status: 'error', reason: 'missing' }
    : { status: 'error', reason: 'invalid', errors: result.errors };
}

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfigState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    loadProjectConfig().then((result) => {
      if (!cancelled) setState(toConfigState(result));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <ConfigCtx.Provider value={state}>{children}</ConfigCtx.Provider>;
}

export function useConfigState(): ConfigState {
  return useContext(ConfigCtx);
}

/** Throws if called before the config has finished loading — only use below the loading/error gate. */
export function useProjectConfig(): ProjectConfig {
  const state = useContext(ConfigCtx);
  if (state.status !== 'ready') {
    throw new Error('useProjectConfig called before config finished loading');
  }
  return state.config;
}
