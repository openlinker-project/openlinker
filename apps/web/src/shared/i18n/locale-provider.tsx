/**
 * Locale Provider
 *
 * Holds the active language for the app. Without a `locale` prop it opens in
 * the language `resolveInitialLocale` picks and lets the operator switch;
 * a `locale` prop pins the starting language (tests pin English). Switching
 * persists the choice, updates `<html lang>` and the language the API client
 * sends, and re-renders copy without a reload.
 *
 * @module shared/i18n
 * @see {@link useLocale} and {@link useCopy} for consumers
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
import { env } from '../config/env';
import { setActiveLocale } from './active-locale';
import { getBcp47Locale } from './locale';
import { resolveInitialLocale, storeLocale } from './resolve-locale';
import {
  isSupportedLocale,
  SOURCE_LOCALE,
  type LocaleCode,
  type LocaleContextValue,
  type SupportedLocale,
  type TranslationCatalog,
} from './i18n.types';

export const LocaleContext = createContext<LocaleContextValue | null>(null);

const EMPTY_CATALOG: TranslationCatalog = Object.freeze({});

interface LocaleProviderProps extends PropsWithChildren {
  /**
   * Starting language. Omit to resolve it from `?lang=`, storage and the
   * deployment default. An unsupported code falls back to English, the
   * language every copy file is complete in.
   */
  locale?: LocaleCode;
  /**
   * Catalog for the legacy `t(key, fallback)` seam (#612); new copy lives in
   * typed copy files instead.
   */
  catalog?: TranslationCatalog;
}

function initialLocale(pinned: LocaleCode | undefined): SupportedLocale {
  if (pinned === undefined) return resolveInitialLocale(env.VITE_DEFAULT_UI_LOCALE);
  return isSupportedLocale(pinned) ? pinned : SOURCE_LOCALE;
}

export function LocaleProvider({
  locale: pinned,
  catalog = EMPTY_CATALOG,
  children,
}: LocaleProviderProps): ReactElement {
  const [locale, setLocaleState] = useState<SupportedLocale>(() => initialLocale(pinned));

  useEffect(() => {
    if (pinned !== undefined) setLocaleState(initialLocale(pinned));
  }, [pinned]);

  // Set during render, not in an effect: children's effects run before this
  // provider's, and a child's first request must already carry the language.
  setActiveLocale(locale);

  useEffect(() => {
    document.documentElement.lang = getBcp47Locale(locale);
  }, [locale]);

  const setLocale = useCallback((next: SupportedLocale) => {
    storeLocale(next);
    setLocaleState(next);
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, fallback) => catalog[key] ?? fallback,
    }),
    [locale, setLocale, catalog],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
