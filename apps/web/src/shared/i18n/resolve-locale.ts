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

/**
 * Read a language tag the way an operator or a deployment writes it:
 * case-insensitive, and a region (`pl-PL`, `en_GB`) is ignored.
 */
export function normalizeLocaleTag(value: string | null | undefined): SupportedLocale | null {
  if (!value) return null;
  const primary = value.trim().toLowerCase().split(/[-_]/)[0];
  return isSupportedLocale(primary) ? primary : null;
}

export function readStoredLocale(): SupportedLocale | null {
  try {
    return normalizeLocaleTag(window.localStorage.getItem(LOCALE_STORAGE_KEY));
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
  return normalizeLocaleTag(new URLSearchParams(search).get(LOCALE_QUERY_PARAM));
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
    readQueryLocale(search) ?? stored ?? normalizeLocaleTag(deploymentDefault) ?? FALLBACK_LOCALE
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
