/**
 * useTranslation Hook
 *
 * Consumer hook for the i18n seam. Returns the current locale and a no-op
 * `t(key, fallback)` translator (v1 always returns `fallback` because the
 * host catalog is empty). Throws if mounted outside `LocaleProvider` — the
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
