/**
 * ThemePicker
 *
 * The theme choice laid out in place (#4029), for a settings menu: the three
 * modes as a `SegmentedSwitch` with their names always shown. Replaces the
 * text-only `ThemeToggle` in the user menu.
 *
 * @module features/appearance/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n/use-messages';
import { useTheme } from '../../../shared/theme/use-theme';
import { SegmentedSwitch, type SegmentedSwitchLabels } from '../../../shared/ui/segmented-switch';
import { useThemeOptions } from '../hooks/use-theme-options';

export interface ThemePickerProps {
  /** When the names show; a menu has room for them, so `always` by default. */
  labels?: SegmentedSwitchLabels;
  /** Accessible name of the group; defaults to "Theme". */
  label?: string;
  className?: string;
}

export function ThemePicker({
  labels = 'always',
  label,
  className,
}: ThemePickerProps): ReactElement {
  const { theme, setTheme } = useTheme();
  const copy = useMessages('ui').theme;
  const options = useThemeOptions();
  return (
    <SegmentedSwitch
      className={['theme-picker', className].filter(Boolean).join(' ')}
      options={options}
      value={theme}
      onChange={setTheme}
      labels={labels}
      aria-label={label ?? copy.label}
    />
  );
}
