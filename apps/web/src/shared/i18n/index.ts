/**
 * shared/i18n - public barrel
 *
 * The only import path for translation and locale helpers (ADR-079). Copy
 * files are declared with `defineCopy` and read with `useCopy`; the legacy
 * `useTranslation` / `t(key, fallback)` seam (#612) stays for its existing
 * call sites and gets no new callers.
 *
 * @module shared/i18n
 */
export { LocaleProvider } from './locale-provider';
export { useLocale } from './use-locale';
export type { UseLocaleResult } from './use-locale';
export { useCopy } from './use-copy';
export { defineCopy, resolveCopy } from './define-copy';
export { interpolate } from './interpolate';
export type { InterpolationParams } from './interpolate';
export { renderRich } from './render-rich';
export type { RichParts } from './render-rich';
export { getLocale } from './active-locale';
export { usePlural } from './use-plural';
export type { PluralFn } from './use-plural';
export { formatPlural, selectPluralForm } from './plural';
export { useFormat } from './use-format';
export type { Formatters } from './use-format';
export { useTranslation } from './use-translation';
export { useNumberFormat } from './use-number-format';
export { getBcp47Locale } from './locale';
export {
  LocaleCodeValues,
  SOURCE_LOCALE,
  FALLBACK_LOCALE,
  isSupportedLocale,
} from './i18n.types';
export type {
  LocaleCode,
  SupportedLocale,
  TranslationCatalog,
  LocaleContextValue,
} from './i18n.types';
export type {
  CopyTree,
  EnglishPlural,
  PolishPlural,
  PluralForms,
  PolishCopy,
  ResolvedCopy,
  LocaleCopy,
} from './copy.types';
