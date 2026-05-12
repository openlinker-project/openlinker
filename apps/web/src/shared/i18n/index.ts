/**
 * shared/i18n — public barrel
 *
 * Public surface for the i18n seam (#612). The seam is a no-op in v1; the
 * shape exists for plugin authors and future per-feature string-migration
 * PRs.
 *
 * @module shared/i18n
 */
export { LocaleProvider } from './locale-provider';
export { useTranslation } from './use-translation';
export { useNumberFormat } from './use-number-format';
export { LocaleCodeValues } from './i18n.types';
export type { LocaleCode, TranslationCatalog, LocaleContextValue } from './i18n.types';
