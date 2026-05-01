/**
 * ThemeToggle
 *
 * Three-option theme switcher (Light / Dark / System) wrapping `useTheme`.
 * Ships as an ARIA radiogroup of native buttons with full keyboard parity:
 *
 *   - Tab enters/exits the group at the currently-selected radio (roving
 *     tabindex: only the checked option is in the tab order).
 *   - ArrowLeft / ArrowUp moves to the previous option and selects it.
 *   - ArrowRight / ArrowDown moves to the next option and selects it.
 *   - Home / End jump to the first / last option.
 *   - Enter / Space on a focused radio selects it (native button behaviour).
 *
 * Intended to live in the user-chip dropdown once AppShell is rebuilt;
 * callers can also place it elsewhere.
 */
import { useMemo, useRef, type KeyboardEvent, type ReactElement } from 'react';
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
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const classes = ['theme-toggle', className].filter(Boolean).join(' ');

  // Stable ref-callback identities. Inline `ref={(el) => {...}}` produces
  // a fresh function each render, which under React 19's stricter
  // ref-cleanup contract — combined with merged-ref machinery in ancestors
  // like Radix's DropdownMenu Slot and react-router's Link — tears down
  // and reattaches the ref on every render, dispatching state updates
  // that trigger more renders → infinite loop (#461).
  const setOptionRef = useMemo(
    () =>
      THEME_OPTIONS.map((_, index) => (el: HTMLButtonElement | null): void => {
        optionRefs.current[index] = el;
      }),
    [],
  );

  function moveTo(nextIndex: number): void {
    const option = THEME_OPTIONS[nextIndex];
    setTheme(option.value);
    optionRefs.current[nextIndex]?.focus();
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ): void {
    const total = THEME_OPTIONS.length;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        moveTo((currentIndex - 1 + total) % total);
        break;
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        moveTo((currentIndex + 1) % total);
        break;
      case 'Home':
        event.preventDefault();
        moveTo(0);
        break;
      case 'End':
        event.preventDefault();
        moveTo(total - 1);
        break;
    }
  }

  return (
    <div role="radiogroup" aria-label={label} className={classes}>
      {THEME_OPTIONS.map((option, index) => {
        const selected = theme === option.value;
        return (
          <button
            key={option.value}
            ref={setOptionRef[index]}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={
              selected ? 'theme-toggle__option theme-toggle__option--active' : 'theme-toggle__option'
            }
            onClick={() => setTheme(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
