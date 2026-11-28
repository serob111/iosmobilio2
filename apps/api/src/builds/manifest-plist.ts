export type ManifestPlistInput = {
  /** A fresh, short-lived signed URL to the .ipa — generated at request time, never stored. */
  ipaUrl: string;
  bundleId: string;
  shortVersion: string;
  displayName: string;
};

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * The itms-services manifest.plist an iOS device reads when a user taps an
 * itms-services://?action=download-manifest&url=... link — hand-built rather than via
 * the `plist` package's generic object serializer, since this is one small, fixed-shape
 * document (items -> assets/metadata), not worth a dependency for. Every dynamic value
 * is XML-escaped; none of these fields are attacker-controlled in practice (bundleId is
 * server-generated, shortVersion comes from shell_releases, displayName is the
 * project's own name), but escaping costs nothing and this is exactly the kind of
 * template where skipping it would be a real injection risk if that ever changed.
 */
export function buildManifestPlist(input: ManifestPlistInput): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>items</key>
	<array>
		<dict>
			<key>assets</key>
			<array>
				<dict>
					<key>kind</key>
					<string>software-package</string>
					<key>url</key>
					<string>${escapeXml(input.ipaUrl)}</string>
				</dict>
			</array>
			<key>metadata</key>
			<dict>
				<key>bundle-identifier</key>
				<string>${escapeXml(input.bundleId)}</string>
				<key>bundle-version</key>
				<string>${escapeXml(input.shortVersion)}</string>
				<key>kind</key>
				<string>software</string>
				<key>title</key>
				<string>${escapeXml(input.displayName)}</string>
			</dict>
		</dict>
	</array>
</dict>
</plist>
`;
}
