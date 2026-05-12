/**
 * Locale Provider
 *
 * Wraps the app in a no-op i18n seam (#612). Today the catalog is empty and
 * every `t(key, fallback)` returns `fallback`; the seam exists so plugin
 * authors and future per-feature string migrations have a stable target.
 *
 * **No string migration ships with this provider** — the only host-side
 * consumer is `useNumberFormat()` (replaces a single hardcoded
 * `Intl.NumberFormat('en-US')` in `app-shell.tsx`). Every other label in the
 * app remains inline English; migrating them is a per-feature follow-up.
 *
 * @module shared/i18n
 * @see {@link useTranslation} for the consumer hook
 * @see {@link useNumberFormat} for locale-aware number formatting
 */
import { createContext, useMemo, type PropsWithChildren, type ReactElement } from 'react';
import type {
  LocaleCode,
  LocaleContextValue,
  TranslationCatalog,
} from './i18n.types';

export const LocaleContext = createContext<LocaleContextValue | null>(null);

interface LocaleProviderProps extends PropsWithChildren {
  /**
   * Defaults to `'en'`. Plugin authors and tests can override; the host has
   * no UI for switching today (no `setLocale` exposed in v1 — adding one
   * means introducing persistence and a switcher together).
   */
  locale?: LocaleCode;
  /**
   * Defaults to `{}` (no-op `t`). A future loader will populate this from a
   * per-locale JSON load; plugins shipping message catalogs can pass theirs
   * directly during tests.
   */
  catalog?: TranslationCatalog;
}

export function LocaleProvider({
  locale = 'en',
  catalog = EMPTY_CATALOG,
  children,
}: LocaleProviderProps): ReactElement {
  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      t: (key, fallback) => catalog[key] ?? fallback,
    }),
    [locale, catalog],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

const EMPTY_CATALOG: TranslationCatalog = Object.freeze({});
