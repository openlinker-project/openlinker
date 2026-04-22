/**
 * Theme Provider
 *
 * Owns the `Theme` preference (`light` / `dark` / `system`) and resolves it to
 * an effective `'light' | 'dark'`. Writes the resolved choice onto the
 * `<html data-theme>` attribute so CSS token overrides in `index.css` take
 * effect globally. Persists explicit choices to localStorage; `system` falls
 * back to `prefers-color-scheme`.
 *
 * Mounted high in the tree (above any consumer that reads tokens). The FOUC
 * guard inline script in `index.html` sets the initial `data-theme` before
 * React hydrates — the provider then takes over via `useEffect`.
 */
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
  type ReactElement,
} from 'react';
import {
  THEME_STORAGE_KEY,
  ThemeValues,
  type EffectiveTheme,
  type Theme,
} from './theme.types';

interface ThemeContextValue {
  theme: Theme;
  effectiveTheme: EffectiveTheme;
  setTheme: (next: Theme) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && ThemeValues.includes(value as Theme);
}

function readStoredTheme(): Theme {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : 'system';
  } catch {
    // localStorage may be disabled (private mode, strict cookie policy). Fall
    // through to `system`.
    return 'system';
  }
}

function resolveEffectiveTheme(theme: Theme): EffectiveTheme {
  if (theme === 'light' || theme === 'dark') return theme;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyEffectiveTheme(effective: EffectiveTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', effective);
}

export function ThemeProvider({ children }: PropsWithChildren): ReactElement {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());
  const [effectiveTheme, setEffectiveTheme] = useState<EffectiveTheme>(() =>
    resolveEffectiveTheme(theme),
  );

  useEffect(() => {
    const effective = resolveEffectiveTheme(theme);
    setEffectiveTheme(effective);
    applyEffectiveTheme(effective);
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system') return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent): void => {
      const effective: EffectiveTheme = event.matches ? 'dark' : 'light';
      setEffectiveTheme(effective);
      applyEffectiveTheme(effective);
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme): void => {
    setThemeState(next);
    try {
      if (next === 'system') {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      }
    } catch {
      // Ignore storage failures; the in-memory state still updates.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, effectiveTheme, setTheme }),
    [theme, effectiveTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
