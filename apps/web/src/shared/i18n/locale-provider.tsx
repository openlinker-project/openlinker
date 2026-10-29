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
import { applyZodLocale } from './zod-locale';
import { getBcp47Locale } from './locale';
import {
  clearPseudoRequested,
  readPseudoRequested,
  resolveInitialLocale,
  storeLocale,
} from './resolve-locale';
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

function announceLocale(locale: SupportedLocale): void {
  setActiveLocale(locale);
  applyZodLocale(locale);
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
  const [locale, setLocaleState] = useState<SupportedLocale>(() => {
    const first = initialLocale(pinned);
    // Written where the language is decided, not on every render: a render
    // React discards must not leave the global on a language nothing showed.
    // Only the root provider may be unpinned; with nested providers the last
    // one to decide wins.
    announceLocale(first);
    return first;
  });
  const [lastPinned, setLastPinned] = useState(pinned);
  const [pseudo, setPseudo] = useState<boolean>(
    () =>
      pinned === undefined &&
      typeof window !== 'undefined' &&
      readPseudoRequested(window.location.search, import.meta.env.DEV),
  );

  // A new pinned value replaces the state during render, so the old language
  // never commits (React's "adjust state when a prop changes" pattern).
  if (pinned !== lastPinned) {
    setLastPinned(pinned);
    if (pinned !== undefined) {
      const next = initialLocale(pinned);
      announceLocale(next);
      setLocaleState(next);
    }
  }

  const isPinned = pinned !== undefined;

  useEffect(() => {
    document.documentElement.lang = getBcp47Locale(locale);
  }, [locale]);

  // A deterministic marker for the e2e overflow pass, which must tell "pseudo
  // is on" apart from "this screen has no migrated text yet".
  useEffect(() => {
    if (pseudo) document.documentElement.dataset.pseudoLocale = 'true';
    else delete document.documentElement.dataset.pseudoLocale;
  }, [pseudo]);

  const setLocale = useCallback(
    (next: SupportedLocale) => {
      if (!isPinned) storeLocale(next);
      announceLocale(next);
      clearPseudoRequested();
      setPseudo(false);
      setLocaleState(next);
    },
    [isPinned],
  );

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      pseudo,
      t: (key, fallback) => catalog[key] ?? fallback,
    }),
    [locale, setLocale, pseudo, catalog],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
