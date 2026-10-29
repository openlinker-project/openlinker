/**
 * Active locale outside React
 *
 * The provider mirrors its current language here so code that runs outside
 * the component tree - the API client's `Accept-Language` header - can read
 * it without a hook. Components use `useLocale` instead.
 *
 * @module shared/i18n
 */
import { SOURCE_LOCALE, type SupportedLocale } from './i18n.types';

let activeLocale: SupportedLocale = SOURCE_LOCALE;

export function getLocale(): SupportedLocale {
  return activeLocale;
}

export function setActiveLocale(locale: SupportedLocale): void {
  activeLocale = locale;
}
