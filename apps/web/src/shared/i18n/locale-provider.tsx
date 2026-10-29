/**
 * Locale Provider
 *
 * Holds the active language for the app. Without a `locale` prop it opens in
 * the language `resolveInitialLocale` picks and lets the operator switch;
 * a `locale` prop pins the starting language (tests pin English). Switching
 * updates `<html lang>` and the language the API client sends, and re-renders
 * copy without a reload; it is saved for the next visit only when the provider
 * is not pinned, so a pinned harness never overwrites the operator's choice.
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
  type LocaleContextValue,
  type SupportedLocale,
  type TranslationCatalog,
} from './i18n.types';

export const LocaleContext = createContext<LocaleContextValue | null>(null);

const EMPTY_CATALOG: TranslationCatalog = Object.freeze({});

interface LocaleProviderProps extends PropsWithChildren {
  /**
   * Starting language. Omit to resolve it from `?lang=`, storage and the
   * deployment default.
   */
  locale?: SupportedLocale;
  /**
   * Catalog for the legacy `t(key, fallback)` seam (#612); new copy lives in
   * typed copy files instead.
   */
  catalog?: TranslationCatalog;
}

function initialLocale(pinned: SupportedLocale | undefined): SupportedLocale {
  if (pinned === undefined) return resolveInitialLocale(env.VITE_DEFAULT_UI_LOCALE);
  // A JavaScript caller can still pass anything; English is complete in every file.
  return isSupportedLocale(pinned) ? pinned : SOURCE_LOCALE;
}

export function LocaleProvider({
  locale: pinned,
  catalog = EMPTY_CATALOG,
  children,
}: LocaleProviderProps): ReactElement {
  const [locale, setLocaleState] = useState<SupportedLocale>(() => initialLocale(pinned));
  const [lastPinned, setLastPinned] = useState(pinned);

  // A new pinned value replaces the state during render, so the old language
  // never commits (React's "adjust state when a prop changes" pattern).
  if (pinned !== lastPinned) {
    setLastPinned(pinned);
    if (pinned !== undefined) setLocaleState(initialLocale(pinned));
  }

  const isPinned = pinned !== undefined;

  // Set during render, not in an effect: children's effects run before this
  // provider's, and a child's first request must already carry the language.
  setActiveLocale(locale);

  useEffect(() => {
    document.documentElement.lang = getBcp47Locale(locale);
  }, [locale]);

  const setLocale = useCallback(
    (next: SupportedLocale) => {
      if (!isPinned) storeLocale(next);
      setLocaleState(next);
    },
    [isPinned],
  );

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
