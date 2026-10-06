/**
 * Filter Toggle Button (#3507)
 *
 * The "Filters (n) ▾" button that opens a `FilterPanel` (desktop accordion) or
 * a `FilterSheet` (mobile). It is a disclosure, not a dialog trigger on
 * desktop: `aria-expanded` + `aria-controls` name the region it reveals, and
 * focus stays on the button when the panel opens. The count badge is the
 * number of active narrowing filters; zero renders no badge at all, because a
 * "0" badge reads as a warning about nothing.
 *
 * @module shared/ui
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { Button } from './button';
import { FILTER_COPY } from './filter.copy';

export interface FilterToggleButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Whether the controlled panel is open — mirrored to `aria-expanded`. */
  expanded: boolean;
  /** Number of active filters; `0` hides the badge. */
  count: number;
  /** Id of the region this button discloses (desktop panel). */
  controls?: string;
  label?: ReactNode;
  /** Optional keyboard shortcut glyph rendered as `.button__shortcut`. */
  shortcut?: string;
}

export const FilterToggleButton = forwardRef<HTMLButtonElement, FilterToggleButtonProps>(
  function FilterToggleButton(
    { expanded, count, controls, label = FILTER_COPY.toggleLabel, shortcut, className = '', ...props },
    ref,
  ): ReactElement {
    const classes = ['button--sm', 'filter-toggle', className].filter(Boolean).join(' ');
    return (
      <Button
        ref={ref}
        tone="secondary"
        className={classes}
        aria-expanded={expanded}
        aria-controls={controls}
        {...props}
      >
        {label}
        {count > 0 ? (
          <span className="filter-toggle__count">
            <span aria-hidden="true">{count}</span>
            <span className="sr-only">{FILTER_COPY.activeCountSuffix(count)}</span>
          </span>
        ) : null}
        <span className="filter-toggle__chev" aria-hidden="true">
          ▼
        </span>
        {shortcut ? (
          <span className="button__shortcut" aria-hidden="true">
            {shortcut}
          </span>
        ) : null}
      </Button>
    );
  },
);
