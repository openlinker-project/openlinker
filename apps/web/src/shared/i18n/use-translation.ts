/**
 * useTranslation Hook
 *
 * Legacy consumer hook (#612): the current locale and a `t(key, fallback)`
 * translator over the provider's flat catalog. Kept for its existing call
 * sites; new copy goes through `defineCopy` + `useCopy` (ADR-079). Throws if mounted outside `LocaleProvider` — the
 * provider is wired at the app root, so this only fires in malformed test
 * setups.
 *
 * @module shared/i18n
 * @see {@link LocaleProvider} for the wrapping provider
 */
import { useContext } from 'react';
import { LocaleContext } from './locale-provider';
import type { LocaleContextValue } from './i18n.types';

export function useTranslation(): Pick<LocaleContextValue, 't' | 'locale'> {
  const ctx = useContext(LocaleContext);
  if (ctx === null) {
    throw new Error('useTranslation must be used inside <LocaleProvider>');
  }
  return { t: ctx.t, locale: ctx.locale };
}
