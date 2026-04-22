/**
 * Chip
 *
 * Filter-bar pill primitive. Thin, pressable by default (ships as a native
 * `<button>`), with `active` toggling a selected state. Used in list-page
 * filter bars where the concept shows chip-style filters instead of raw
 * selects.
 */
import { forwardRef, type ComponentPropsWithoutRef, type ReactElement } from 'react';

export type ChipTone = 'error' | 'info' | 'neutral' | 'success' | 'warning';

export interface ChipProps extends ComponentPropsWithoutRef<'button'> {
  active?: boolean;
  tone?: ChipTone;
}

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { active = false, children, className = '', tone = 'neutral', type = 'button', ...props },
  ref,
): ReactElement {
  const classes = [
    'chip',
    `chip--${tone}`,
    active ? 'chip--active' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      aria-pressed={active}
      {...props}
    >
      {children}
    </button>
  );
});
