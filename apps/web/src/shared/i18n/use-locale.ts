/**
 * useLocale Hook
 *
 * The active language, the switcher, the list of languages the host ships,
 * and the BCP 47 tag for `Intl.*`. Throws outside `LocaleProvider`, which is
 * mounted at the app root, so it only fires in a malformed test setup.
 *
 * @module shared/i18n
 */
import { useContext } from 'react';
import { LocaleContext } from './locale-provider';
import { getBcp47Locale } from './locale';
import { getLocale } from './active-locale';
import { LocaleCodeValues, type SupportedLocale } from './i18n.types';

export interface UseLocaleResult {
  readonly locale: SupportedLocale;
  readonly setLocale: (locale: SupportedLocale) => void;
  readonly locales: readonly SupportedLocale[];
  readonly bcp47: string;
}

export function useLocale(): UseLocaleResult {
  const ctx = useContext(LocaleContext);
  if (ctx === null) {
    throw new Error('useLocale must be used inside <LocaleProvider>');
  }
  return {
    locale: ctx.locale,
    setLocale: ctx.setLocale,
    locales: LocaleCodeValues,
    bcp47: getBcp47Locale(ctx.locale),
  };
}

/**
 * The active language for read-only consumers (copy, formatting, plurals).
 * Outside a provider it falls back to the module-level active language
 * (English until a provider mounts) instead of throwing, so a shared
 * primitive rendered on its own - as many tests do - still shows English.
 */
export function useActiveLocale(): SupportedLocale {
  const ctx = useContext(LocaleContext);
  return ctx?.locale ?? getLocale();
}

/**
 * `useLocale` for components that must also render outside a provider (the
 * language switch inside layouts some tests mount bare): `null` instead of a
 * throw.
 */
export function useOptionalLocale(): UseLocaleResult | null {
  const ctx = useContext(LocaleContext);
  if (ctx === null) return null;
  return {
    locale: ctx.locale,
    setLocale: ctx.setLocale,
    locales: LocaleCodeValues,
    bcp47: getBcp47Locale(ctx.locale),
  };
}
