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

export const LanguageFlagCodeValues = ['pl', 'en', 'de', 'es', 'nl', 'ja'] as const;
export type LanguageFlagCode = (typeof LanguageFlagCodeValues)[number];

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
    case 'de':
      return (
        <svg className="language-flag" viewBox="0 0 15 9" aria-hidden="true">
          <rect width="15" height="3" fill="#000" />
          <rect y="3" width="15" height="3" fill="#dd0000" />
          <rect y="6" width="15" height="3" fill="#ffce00" />
        </svg>
      );
    case 'es':
      return (
        <svg className="language-flag" viewBox="0 0 15 10" aria-hidden="true">
          <rect width="15" height="10" fill="#aa151b" />
          <rect y="2.5" width="15" height="5" fill="#f1bf00" />
        </svg>
      );
    case 'nl':
      return (
        <svg className="language-flag" viewBox="0 0 15 9" aria-hidden="true">
          <rect width="15" height="3" fill="#ae1c28" />
          <rect y="3" width="15" height="3" fill="#fff" />
          <rect y="6" width="15" height="3" fill="#21468b" />
        </svg>
      );
    case 'ja':
      return (
        <svg className="language-flag" viewBox="0 0 15 10" aria-hidden="true">
          <rect width="15" height="10" fill="#fff" />
          <circle cx="7.5" cy="5" r="3" fill="#bc002d" />
        </svg>
      );
  }
}
