/**
 * ThemeIcon
 *
 * The three theme icons (#4029): a sun, a moon, and a screen for "auto"
 * (follow the device). Sized by the slot it sits in.
 *
 * @module features/appearance/components
 */
import type { ReactElement } from 'react';
import type { Theme } from '../../../shared/theme/theme.types';

export function ThemeIcon({ theme }: { theme: Theme }): ReactElement {
  return (
    <svg className="theme-icon" viewBox="0 0 16 16" aria-hidden="true">
      {theme === 'light' ? (
        <>
          <circle cx="8" cy="8" r="3" fill="currentColor" />
          <path
            d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </>
      ) : theme === 'dark' ? (
        <path d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1Z" fill="currentColor" />
      ) : (
        <>
          <rect
            x="1.75"
            y="2.75"
            width="12.5"
            height="8.5"
            rx="1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path d="M5.5 13.75h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
