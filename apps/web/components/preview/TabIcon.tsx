import type { SupportedIcon } from "@mobilio/config";

type Props = {
  icon: string;
  color: string;
  size?: number;
};

/**
 * Minimal line-icon set for the preview shell's tab bar, covering exactly
 * SUPPORTED_ICONS — mirrors apps/shell's Ionicons names by meaning, not asset, since the
 * web preview can't depend on React Native's icon font. Unknown icon names (shouldn't
 * happen — the schema already validates this — but the preview is public-facing, so this
 * stays defensive) fall back to a plain circle.
 */
const PATHS: Record<SupportedIcon, string> = {
  home: "M3 11.5 12 4l9 7.5M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  location: "M12 21s7-6.3 7-11.5A7 7 0 0 0 5 9.5C5 14.7 12 21 12 21ZM12 11.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  cart: "M3 4h2l2.4 12.2a1 1 0 0 0 1 .8h8.4a1 1 0 0 0 1-.8L20 8H6M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm9 2-4.3-4.3",
  heart: "M12 20s-7.5-4.6-9.5-9.3C1 7 3 4 6.3 4 8.4 4 10.2 5.3 12 7c1.8-1.7 3.6-3 5.7-3 3.3 0 5.3 3 4.8 6.7C20.5 15.4 12 20 12 20Z",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v.01M12 11v6",
  chat: "M4 4h16v11H9l-5 4V4Z",
};

export function TabIcon({ icon, color, size = 22 }: Props) {
  const d = PATHS[icon as SupportedIcon];
  if (!d) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="8" stroke={color} strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d={d} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
