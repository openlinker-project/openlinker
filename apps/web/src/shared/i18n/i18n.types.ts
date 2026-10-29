/**
 * i18n Types
 *
 * Type contract for the locale + translation seam. The app ships Polish and
 * English (ADR-079) and everything speaks `SupportedLocale`. `LocaleCode` is
 * kept as an alias for existing imports; it no longer admits other codes, so
 * a plugin that pinned `<LocaleProvider locale="de">` now gets a type error
 * instead of a silent switch to English.
 *
 * @module shared/i18n
 * @see {@link LocaleProvider} for the React-side wiring
 */

/**
 * Locales the host ships, in the order the language switch lists them.
 */
export const LocaleCodeValues = ['pl', 'en'] as const;

export type SupportedLocale = (typeof LocaleCodeValues)[number];

/** @deprecated Use `SupportedLocale`. */
export type LocaleCode = SupportedLocale;

/**
 * The language every copy object must be complete in. Polish falls back to it
 * per key until the lock-in step (#3891) makes Polish required.
 */
export const SOURCE_LOCALE: SupportedLocale = 'en';

/**
 * Used when neither the operator nor the deployment named a supported
 * language (ADR-079 decision 3).
 */
export const FALLBACK_LOCALE: SupportedLocale = 'pl';

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (LocaleCodeValues as readonly string[]).includes(value);
}

/**
 * A flat key->string map for the legacy `t(key, fallback)` seam.
 */
export interface TranslationCatalog {
  readonly [key: string]: string;
}

export interface LocaleContextValue {
  readonly locale: SupportedLocale;
  readonly setLocale: (locale: SupportedLocale) => void;
  readonly t: (key: string, fallback: string) => string;
}
