import * as Localization from 'expo-localization';
import en from './messages/en.json';
import ru from './messages/ru.json';

const MESSAGES = { en, ru } as const;
type Locale = keyof typeof MESSAGES;
const DEFAULT_LOCALE: Locale = 'en';

function isSupportedLocale(code: string | null | undefined): code is Locale {
  return code === 'en' || code === 'ru';
}

/** Device language, falling back to English for anything not yet translated. */
export function resolveLocale(): Locale {
  const code = Localization.getLocales()[0]?.languageCode;
  return isSupportedLocale(code) ? code : DEFAULT_LOCALE;
}

/** Project-authored content (tab titles, onboarding slide text, ...) is never looked up here — only this shell's own fixed UI strings. */
export function t<Namespace extends keyof typeof en>(namespace: Namespace): (typeof en)[Namespace] {
  return MESSAGES[resolveLocale()][namespace];
}
