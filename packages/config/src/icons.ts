/** Shared icon vocabulary for tabs — kept in sync between the web editor's icon picker and the shell's TabBar. */
export const SUPPORTED_ICONS = [
  'home',
  'grid',
  'location',
  'cart',
  'person',
  'search',
  'heart',
  'info',
  'chat',
] as const;

export type SupportedIcon = (typeof SUPPORTED_ICONS)[number];
