/**
 * Language options
 *
 * The languages the app ships, with their native names (ADR-081). Native, not
 * translated: someone who cannot read the current language still finds theirs.
 *
 * @module features/language/hooks
 */
import { LocaleCodeValues, type SupportedLocale } from '../../../shared/i18n/i18n.types';

export interface LanguageOption {
  code: SupportedLocale;
  /** The language's name in that language. */
  name: string;
  /**
   * The translation is not complete: some screens still fall back to English.
   * Polish carries it until the lock-in step (#3891) makes it complete.
   */
  beta?: boolean;
}

// A Record keyed by `SupportedLocale`: a language added to `LocaleCodeValues`
// without a name here is a compile error instead of a missing list entry.
const LANGUAGE_DETAILS: Record<SupportedLocale, { name: string; beta?: boolean }> = {
  pl: { name: 'Polski', beta: true },
  en: { name: 'English' },
};

export const LANGUAGE_OPTIONS: readonly LanguageOption[] = LocaleCodeValues.map((code) => ({
  code,
  ...LANGUAGE_DETAILS[code],
}));

/** The shipped languages, in display order. */
export function useLanguageOptions(): readonly LanguageOption[] {
  return LANGUAGE_OPTIONS;
}
