/**
 * Locale resolution
 *
 * Decides which language the app opens in (ADR-079 decision 3): a `?lang=`
 * override (saved), then the operator's stored choice, then the deployment
 * default `VITE_DEFAULT_UI_LOCALE`, then `FALLBACK_LOCALE` (the same value an
 * unset variable gives). The browser language is
 * deliberately not consulted. Storage access is guarded because private
 * windows and blocked site data make it throw.
 *
 * @module shared/i18n
 */
import { FALLBACK_LOCALE, isSupportedLocale, type SupportedLocale } from './i18n.types';
import { PSEUDO_LOCALE_CODE } from './pseudo';

export const LOCALE_STORAGE_KEY = 'openlinker.locale';
export const LOCALE_QUERY_PARAM = 'lang';
const PSEUDO_SESSION_KEY = 'openlinker.pseudo-locale';

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

// Saved once, then dropped: left in the URL it would re-apply on every reload
// and overwrite a language the operator picked since.
function stripQueryLocale(): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete(LOCALE_QUERY_PARAM);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  } catch {
    // History unavailable: the parameter simply stays.
  }
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
    stripQueryLocale();
    return fromQuery;
  }
  return resolveLocale({ search: '', stored: readStoredLocale(), deploymentDefault });
}

/**
 * Whether the development-only pseudo-language was asked for (`?lang=xx`,
 * remembered for the session). Always false in a production build.
 */
export function readPseudoRequested(search: string, isDev: boolean): boolean {
  if (!isDev) return false;
  const fromQuery = new URLSearchParams(search).get(LOCALE_QUERY_PARAM);
  try {
    if (fromQuery === PSEUDO_LOCALE_CODE) {
      window.sessionStorage.setItem(PSEUDO_SESSION_KEY, '1');
      return true;
    }
    if (fromQuery !== null) window.sessionStorage.removeItem(PSEUDO_SESSION_KEY);
    return window.sessionStorage.getItem(PSEUDO_SESSION_KEY) === '1';
  } catch {
    return fromQuery === PSEUDO_LOCALE_CODE;
  }
}
