import type { ProjectConfig } from '@mobilio/config';

/** Used in Expo Go / web preview when no `?project=` id is present or it can't be loaded. */
export const demoConfig: ProjectConfig = {
  id: 'demo',
  name: 'Mobilio Demo',
  slug: 'mobilio-demo',
  bundleId: 'am.mobilio.trial.demo',
  source: { type: 'url', url: 'https://example.com' },
  theme: { primary: '#2563EB', background: '#FFFFFF', statusBar: 'dark' },
  tabs: [
    { title: 'Главная', icon: 'home', path: '/' },
    { title: 'Контакты', icon: 'location', native: 'contacts' },
  ],
  nativeScreens: {
    onboarding: {
      enabled: true,
      slides: [
        { title: 'Добро пожаловать в Mobilio', text: 'Превращаем ваш сайт в настоящее iOS-приложение.' },
        { title: 'Это демо-проект', text: 'Реальный проект создаётся на сайте mobilio.am.' },
      ],
    },
    contacts: {
      phone: '+1 555 0100',
      address: 'Demo Street 1',
      mapUrl: 'https://maps.google.com',
    },
  },
  features: { offline: true, share: true, deepLinks: false, pullToRefresh: true },
  allowedDomains: ['example.com'],
  trial: true,
};
