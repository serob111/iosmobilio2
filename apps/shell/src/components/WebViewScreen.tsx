import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { File, Paths } from 'expo-file-system';
import * as WebBrowser from 'expo-web-browser';
import { useNetworkState } from 'expo-network';
import type { ProjectConfig } from '@mobilio/config';
import { OfflineScreen } from './OfflineScreen';
import { BRIDGE_INJECTED_JS, handleBridgeMessage } from '../bridge/nativeBridge';
import { apiBaseUrl, isWeb } from '../lib/env';
import { pushLog } from '../lib/debugLog';

type Tab = ProjectConfig['tabs'][number];

type Props = {
  tab: Tab;
  config: ProjectConfig;
};

function isAllowedHost(hostname: string, allowedDomains: string[]): boolean {
  return allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function resolveUrlTarget(config: ProjectConfig, tab: Tab): string | null {
  if (config.source.type !== 'url' || !tab.path) return null;
  try {
    return new URL(tab.path, config.source.url).toString();
  } catch {
    return null;
  }
}

export function WebViewScreen({ tab, config }: Props) {
  const webviewRef = useRef<WebView>(null);
  const network = useNetworkState();
  const [retryKey, setRetryKey] = useState(0);
  const [loadError, setLoadError] = useState(false);
  // undefined = still checking the bundle, null = not found, string = resolved file:// uri
  const [htmlUri, setHtmlUri] = useState<string | null | undefined>(undefined);

  const urlTarget = useMemo(() => resolveUrlTarget(config, tab), [config, tab]);

  useEffect(() => {
    if (isWeb || config.source.type !== 'html') return undefined;
    const entry = config.source.entry;
    let cancelled = false;
    (async () => {
      const file = new File(Paths.bundle, 'mobilio', 'www', entry);
      if (!cancelled) setHtmlUri(file.exists ? file.uri : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [config.source, retryKey]);

  const offline = config.features.offline && network.isInternetReachable === false;

  if (offline) {
    return <OfflineScreen primaryColor={config.theme.primary} onRetry={() => setRetryKey((k) => k + 1)} />;
  }

  if (loadError) {
    return (
      <OfflineScreen
        primaryColor={config.theme.primary}
        onRetry={() => {
          setLoadError(false);
          setRetryKey((k) => k + 1);
        }}
      />
    );
  }

  if (config.source.type === 'html' && isWeb) {
    return (
      <OfflineScreen
        primaryColor={config.theme.primary}
        title="Предпросмотр HTML пока недоступен"
        subtitle="Появится вместе с веб-приложением Mobilio"
        onRetry={() => setRetryKey((k) => k + 1)}
      />
    );
  }

  if (config.source.type === 'html' && htmlUri === null) {
    return (
      <OfflineScreen
        primaryColor={config.theme.primary}
        title="Содержимое не найдено"
        subtitle="HTML-режим будет доступен после сборки шаблона приложения"
        onRetry={() => setRetryKey((k) => k + 1)}
      />
    );
  }

  if (config.source.type === 'html' && htmlUri === undefined) {
    return <View style={styles.flex} />;
  }

  if (config.source.type === 'url' && !urlTarget) {
    return (
      <OfflineScreen
        primaryColor={config.theme.primary}
        title="Не удалось открыть страницу"
        subtitle="Проверьте настройки вкладки"
        onRetry={() => setRetryKey((k) => k + 1)}
      />
    );
  }

  if (isWeb && urlTarget) {
    const proxied = `${apiBaseUrl}/api/proxy?url=${encodeURIComponent(urlTarget)}`;
    return (
      <View style={styles.flex} key={retryKey}>
        {React.createElement('iframe', {
          src: proxied,
          title: config.name,
          style: { flex: 1, border: 'none', width: '100%', height: '100%' },
        })}
      </View>
    );
  }

  const source =
    config.source.type === 'html' && htmlUri
      ? { uri: htmlUri, baseUrl: htmlUri.replace(/[^/]+$/, '') }
      : { uri: urlTarget ?? '' };

  return (
    <WebView
      key={retryKey}
      ref={webviewRef}
      source={source}
      allowingReadAccessToURL={config.source.type === 'html' ? Paths.bundle.uri : undefined}
      pullToRefreshEnabled={config.features.pullToRefresh}
      injectedJavaScriptBeforeContentLoaded={BRIDGE_INJECTED_JS}
      onMessage={(event) => {
        void handleBridgeMessage(event.nativeEvent.data, webviewRef);
      }}
      onShouldStartLoadWithRequest={(request) => {
        if (config.source.type !== 'url') return true;
        try {
          const hostname = new URL(request.url).hostname;
          if (isAllowedHost(hostname, config.allowedDomains)) return true;
          pushLog('info', 'webview', `Opening external host in browser: ${hostname}`);
          void WebBrowser.openBrowserAsync(request.url);
          return false;
        } catch {
          return true;
        }
      }}
      onError={() => setLoadError(true)}
      onHttpError={() => setLoadError(true)}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
