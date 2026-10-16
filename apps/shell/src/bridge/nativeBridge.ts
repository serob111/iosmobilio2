import { z } from 'zod';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { Platform, Share } from 'react-native';
import type WebView from 'react-native-webview';
import { appVersion } from '../lib/env';
import { pushLog } from '../lib/debugLog';

/** Injected before page load: defines the window.NativeApp JS bridge as a postMessage RPC. */
export const BRIDGE_INJECTED_JS = `
(function () {
  if (window.NativeApp) return;
  var seq = 0;
  var pending = {};
  function call(method, params) {
    return new Promise(function (resolve) {
      var id = ++seq;
      pending[id] = resolve;
      window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, method: method, params: params || null }));
    });
  }
  window.__mobilioResolve = function (id, result) {
    var resolve = pending[id];
    if (resolve) {
      delete pending[id];
      resolve(result);
    }
  };
  window.NativeApp = {
    share: function (params) { return call('share', params); },
    haptic: function (params) { return call('haptic', params); },
    openExternal: function (params) { return call('openExternal', params); },
    platform: function () { return call('getPlatform'); },
    version: function () { return call('getVersion'); },
  };
  true;
})();
`;

const BridgeMessageSchema = z.object({
  id: z.number(),
  method: z.enum(['share', 'haptic', 'openExternal', 'getPlatform', 'getVersion']),
  params: z.unknown().optional().nullable(),
});

const ShareParamsSchema = z.object({ url: z.string().optional(), message: z.string().optional() });
const OpenExternalParamsSchema = z.object({ url: z.string() });

async function runBridgeMethod(
  method: z.infer<typeof BridgeMessageSchema>['method'],
  params: unknown,
): Promise<unknown> {
  switch (method) {
    case 'share': {
      const parsed = ShareParamsSchema.safeParse(params);
      if (!parsed.success || (!parsed.data.url && !parsed.data.message)) {
        return { ok: false, error: 'invalid params' };
      }
      await Share.share({ url: parsed.data.url, message: parsed.data.message ?? parsed.data.url ?? '' });
      return { ok: true };
    }
    case 'haptic': {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return { ok: true };
    }
    case 'openExternal': {
      const parsed = OpenExternalParamsSchema.safeParse(params);
      if (!parsed.success) return { ok: false, error: 'invalid params' };
      await WebBrowser.openBrowserAsync(parsed.data.url);
      return { ok: true };
    }
    case 'getPlatform':
      return { ok: true, platform: Platform.OS };
    case 'getVersion':
      return { ok: true, version: appVersion };
    default:
      return { ok: false, error: 'unknown method' };
  }
}

/** Validates and dispatches a message posted from the page's window.NativeApp bridge. */
export async function handleBridgeMessage(
  rawData: string,
  webviewRef: React.RefObject<WebView | null>,
): Promise<void> {
  let json: unknown;
  try {
    json = JSON.parse(rawData);
  } catch {
    pushLog('warn', 'bridge', 'Received non-JSON bridge message', rawData);
    return;
  }

  const parsed = BridgeMessageSchema.safeParse(json);
  if (!parsed.success) {
    pushLog('warn', 'bridge', 'Rejected invalid bridge message', parsed.error.issues);
    return;
  }

  const { id, method, params } = parsed.data;
  pushLog('info', 'bridge', `Handling ${method}`, params);
  const result = await runBridgeMethod(method, params);
  webviewRef.current?.injectJavaScript(`window.__mobilioResolve(${id}, ${JSON.stringify(result)}); true;`);
}
