/**
 * i18n Types
 *
 * Type contract for the locale + translation seam. The seam is intentionally
 * minimal in v1 — a no-op `t(key, fallback)` and a single `'en'` locale. The
 * shape is here so plugin authors who ship message catalogs in the future
 * have a stable target to bind against.
 *
 * @module shared/i18n
 * @see {@link LocaleProvider} for the React-side wiring
 */

/**
 * Closed set of locales the host ships today. `LocaleCode` widens to `string`
 * so plugins can introduce additional locales (e.g. `'pl'`, `'de'`) without
 * a core PR — the seam doesn't validate against this list. The `as const`
 * array is kept so a future `LocaleSwitcher` UI can iterate the host-shipped
 * options without re-declaring them.
 */
export const LocaleCodeValues = ['en'] as const;

export type LocaleCode = (typeof LocaleCodeValues)[number] | string;

/**
 * A flat key→string map. Today the host ships an empty catalog and every
 * `t()` call returns its `fallback` argument; plugins that want to localise
 * their own UI ship a catalog through the provider's `catalog` prop (or, in
 * the future, a hot-swap loader keyed on `locale`).
 */
export interface TranslationCatalog {
  readonly [key: string]: string;
}

/**
 * Public shape consumed by `useTranslation()` / `useNumberFormat()`. Held in
 * a React context; the context itself is a private export of
 * `locale-provider.tsx`.
 */
export interface LocaleContextValue {
  readonly locale: LocaleCode;
  readonly t: (key: string, fallback: string) => string;
}
