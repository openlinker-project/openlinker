/**
 * useNumberFormat Hook
 *
 * Compatibility shim: returns a shared `Intl.NumberFormat` for the active
 * language. New code uses `useFormat().number`; this stays for its existing
 * callers and routes through the same formatter cache, so an inline `options`
 * object that changes identity every render does not rebuild a formatter.
 *
 * @module shared/i18n
 */
import { numberFormat } from './intl-cache';
import { getBcp47Locale } from './locale';
import { useTranslation } from './use-translation';

export function useNumberFormat(options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const { locale } = useTranslation();
  return numberFormat(getBcp47Locale(locale), options);
}
