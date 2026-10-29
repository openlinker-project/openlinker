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
