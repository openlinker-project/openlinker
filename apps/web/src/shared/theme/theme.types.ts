/**
 * Theme Types
 *
 * Theme selection is a client-owned UI preference (not server state, not URL state).
 * `system` tracks the OS preference via `prefers-color-scheme`; explicit `light` /
 * `dark` overrides it. The resolved effective theme (light or dark) is what the
 * app actually renders.
 */

export const ThemeValues = ['light', 'dark', 'system'] as const;
export type Theme = (typeof ThemeValues)[number];
export type EffectiveTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'openlinker.theme';
