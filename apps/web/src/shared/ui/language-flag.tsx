/**
 * LanguageFlag
 *
 * Small inline SVG flag for a language in the language switch. Inline SVG
 * rather than emoji: Windows renders flag emoji as two plain letters.
 * Decorative only - the language name always sits next to it.
 *
 * @module shared/ui
 */
import type { ReactElement } from 'react';
import type { SupportedLocale } from '../i18n/i18n.types';

/** One flag per language the app ships; a new language adds its flag here. */
export type LanguageFlagCode = SupportedLocale;

interface LanguageFlagProps {
  code: LanguageFlagCode;
}

export function LanguageFlag({ code }: LanguageFlagProps): ReactElement {
  switch (code) {
    case 'pl':
      return (
        <svg className="language-flag" viewBox="0 0 16 10" aria-hidden="true">
          <rect width="16" height="5" fill="#fff" />
          <rect y="5" width="16" height="5" fill="#dc143c" />
        </svg>
      );
    case 'en':
      return (
        <svg className="language-flag" viewBox="0 0 60 40" aria-hidden="true">
          <rect width="60" height="40" fill="#012169" />
          <path d="M0 0L60 40M60 0L0 40" stroke="#fff" strokeWidth="8" />
          <path d="M0 0L60 40M60 0L0 40" stroke="#c8102e" strokeWidth="3" />
          <path d="M30 0V40M0 20H60" stroke="#fff" strokeWidth="12" />
          <path d="M30 0V40M0 20H60" stroke="#c8102e" strokeWidth="7" />
        </svg>
      );
  }
}
