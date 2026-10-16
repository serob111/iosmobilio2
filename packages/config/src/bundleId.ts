/** Derives the bundle id Mobilio expects for a project slug under a given prefix. */
export function deriveBundleId(bundlePrefix: string, slug: string): string {
  return `${bundlePrefix}.${slug.replace(/-/g, '')}`;
}
