import { buildManifestPlist } from './manifest-plist.js';

describe('buildManifestPlist', () => {
  it('produces a valid itms-services manifest with the given values', () => {
    const xml = buildManifestPlist({
      ipaUrl: 'https://api.example/orgs/o/projects/p/builds/b/install.ipa',
      bundleId: 'am.mobilio.t.cafe',
      shortVersion: '1.2.3',
      displayName: 'Cafe Mobilio',
    });

    expect(xml).toContain('<key>bundle-identifier</key>');
    expect(xml).toContain('<string>am.mobilio.t.cafe</string>');
    expect(xml).toContain('<string>1.2.3</string>');
    expect(xml).toContain('<string>Cafe Mobilio</string>');
    expect(xml).toContain('<string>https://api.example/orgs/o/projects/p/builds/b/install.ipa</string>');
    expect(xml).toContain('<string>software-package</string>');
    expect(xml).toContain('<string>software</string>');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  it('XML-escapes a display name containing special characters', () => {
    const xml = buildManifestPlist({
      ipaUrl: 'https://api.example/install.ipa',
      bundleId: 'am.mobilio.t.cafe',
      shortVersion: '1.0.0',
      displayName: 'Tom & Jerry\'s "Café" <Deluxe>',
    });

    expect(xml).toContain('Tom &amp; Jerry&apos;s &quot;Café&quot; &lt;Deluxe&gt;');
    expect(xml).not.toContain('Tom & Jerry\'s "Café" <Deluxe>');
  });

  it('escapes an ampersand in the signed ipa URL (query string separators)', () => {
    const xml = buildManifestPlist({
      ipaUrl: 'https://api.example/install.ipa?a=1&b=2',
      bundleId: 'am.mobilio.t.cafe',
      shortVersion: '1.0.0',
      displayName: 'App',
    });

    expect(xml).toContain('https://api.example/install.ipa?a=1&amp;b=2');
  });
});
