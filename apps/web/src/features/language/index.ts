/**
 * Language feature barrel (#4029)
 *
 * The language picker, built from the shared switch primitives. The locale
 * itself (provider, catalogs, `useLocale`) stays in `shared/i18n`.
 *
 * @module features/language
 */
export { LanguageSwitch, LanguageToggle, restoreFocusAfterLanguageChange } from './components/language-switch';
export type { LanguageSwitchProps, LanguageToggleProps } from './components/language-switch';
export { LANGUAGE_OPTIONS, useLanguageOptions } from './hooks/use-language-options';
export type { LanguageOption } from './hooks/use-language-options';
