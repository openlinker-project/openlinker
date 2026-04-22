/**
 * useTheme
 *
 * Reads the theme preference set by the nearest `ThemeProvider`. Throws if
 * mounted outside a provider — the app always renders `<ThemeProvider>` at
 * the top of the tree via `AppProviders`, so this indicates a wiring bug.
 */
import { useContext } from 'react';
import { ThemeContext } from './theme-provider';
import type { EffectiveTheme, Theme } from './theme.types';

export function useTheme(): {
  theme: Theme;
  effectiveTheme: EffectiveTheme;
  setTheme: (next: Theme) => void;
} {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside a <ThemeProvider>');
  }
  return ctx;
}
