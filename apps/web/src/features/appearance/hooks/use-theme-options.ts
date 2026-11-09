/**
 * useThemeOptions
 *
 * The three themes as switch options (#4029): light, dark and auto (follow
 * the device), with their icons and translated names. One list for every theme
 * control, so the order and the names cannot drift between them.
 *
 * @module features/appearance/hooks
 */
import { createElement, useMemo } from 'react';
import { useMessages } from '../../../shared/i18n/use-messages';
import { ThemeValues, type Theme } from '../../../shared/theme/theme.types';
import type { SegmentedSwitchOption } from '../../../shared/ui/segmented-switch';
import { ThemeIcon } from '../components/theme-icon';

/** How far each icon twists while pressed: the sun spins, the others tip. */
const PRESS_TURN: Record<Theme, number> = { light: 45, dark: -20, system: -20 };

export function useThemeOptions(): SegmentedSwitchOption<Theme>[] {
  const copy = useMessages('ui').theme;
  return useMemo(
    () =>
      ThemeValues.map((value) => ({
        value,
        label: copy[value],
        icon: createElement(ThemeIcon, { theme: value }),
        pressTurn: PRESS_TURN[value],
      })),
    [copy]
  );
}
