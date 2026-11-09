/**
 * Appearance feature barrel (#4029)
 *
 * The theme controls, built from the shared switch primitives. The theme
 * itself (provider, `useTheme`) stays in `shared/theme`.
 *
 * @module features/appearance
 */
export { ThemeSwitch } from './components/theme-switch';
export type { ThemeSwitchProps } from './components/theme-switch';
export { ThemePicker } from './components/theme-picker';
export type { ThemePickerProps } from './components/theme-picker';
export { ThemeIcon } from './components/theme-icon';
export { useThemeOptions } from './hooks/use-theme-options';
