/**
 * Locale resolution
 *
 * Decides which language the app opens in (ADR-079 decision 3): a `?lang=`
 * override (saved), then the operator's stored choice, then the deployment
 * default `VITE_DEFAULT_UI_LOCALE`, then Polish. The browser language is
 * deliberately not consulted. Storage access is guarded because private
 * windows and blocked site data make it throw.
 *
 * @module shared/i18n
 */
import { FALLBACK_LOCALE, isSupportedLocale, type SupportedLocale } from './i18n.types';

export const LOCALE_STORAGE_KEY = 'openlinker.locale';
export const LOCALE_QUERY_PARAM = 'lang';

export function readStoredLocale(): SupportedLocale | null {
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isSupportedLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeLocale(locale: SupportedLocale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Not persisted; the choice still applies for this page view.
  }
}

export function readQueryLocale(search: string): SupportedLocale | null {
  const value = new URLSearchParams(search).get(LOCALE_QUERY_PARAM);
  return isSupportedLocale(value) ? value : null;
}

export interface ResolveLocaleInput {
  readonly search: string;
  readonly stored: SupportedLocale | null;
  readonly deploymentDefault: string | undefined;
}

export function resolveLocale({
  search,
  stored,
  deploymentDefault,
}: ResolveLocaleInput): SupportedLocale {
  return (
    readQueryLocale(search) ??
    stored ??
    (isSupportedLocale(deploymentDefault) ? deploymentDefault : FALLBACK_LOCALE)
  );
}

/**
 * Resolve from the live browser state and persist a `?lang=` override so it
 * survives navigating away from the link that carried it.
 */
export function resolveInitialLocale(deploymentDefault: string | undefined): SupportedLocale {
  const search = typeof window === 'undefined' ? '' : window.location.search;
  const fromQuery = readQueryLocale(search);
  if (fromQuery) {
    storeLocale(fromQuery);
    return fromQuery;
  }
  return resolveLocale({ search: '', stored: readStoredLocale(), deploymentDefault });
}
