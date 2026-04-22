/**
 * ThemeToggle
 *
 * Three-option theme switcher (Light / Dark / System) wrapping `useTheme`.
 * Ships as a radiogroup of native buttons so keyboard and screen-reader
 * semantics come for free. Intended to live in the user-chip dropdown
 * once AppShell is rebuilt in Phase 2; callers can also place it elsewhere.
 */
import type { ReactElement } from 'react';
import { useTheme } from '../theme/use-theme';
import { ThemeValues, type Theme } from '../theme/theme.types';

interface ThemeOption {
  label: string;
  value: Theme;
}

const THEME_OPTIONS: ThemeOption[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

// Defensive check — guards against drift between ThemeValues and the
// option list above.
for (const option of THEME_OPTIONS) {
  if (!ThemeValues.includes(option.value)) {
    throw new Error(`ThemeToggle: unknown theme value "${option.value}"`);
  }
}

interface ThemeToggleProps {
  className?: string;
  label?: string;
}

export function ThemeToggle({
  className = '',
  label = 'Theme',
}: ThemeToggleProps): ReactElement {
  const { theme, setTheme } = useTheme();
  const classes = ['theme-toggle', className].filter(Boolean).join(' ');

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={classes}
    >
      {THEME_OPTIONS.map((option) => {
        const selected = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={
              selected ? 'theme-toggle__option theme-toggle__option--active' : 'theme-toggle__option'
            }
            onClick={() => setTheme(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
