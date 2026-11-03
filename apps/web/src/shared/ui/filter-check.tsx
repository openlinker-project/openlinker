/**
 * Filter Check (#3507)
 *
 * A checkbox or radio row inside a `FilterGroup`: native input (accent-colour
 * themed), a label, and an optional right-aligned mono count. The count is
 * TEXT, never colour alone — `tone` only tints it, so a red "30" still reads
 * "30" without the colour. `count={undefined}` renders no count (unknown is
 * not zero).
 *
 * @module shared/ui
 */
import { forwardRef, type InputHTMLAttributes, type ReactElement, type ReactNode } from 'react';

export type FilterCheckTone = 'neutral' | 'warning' | 'error';

export interface FilterCheckProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> {
  type?: 'checkbox' | 'radio';
  label: ReactNode;
  /** Muted label (e.g. "No tags") — a value that means "absence of". */
  mutedLabel?: boolean;
  count?: number | string;
  tone?: FilterCheckTone;
}

export const FilterCheck = forwardRef<HTMLInputElement, FilterCheckProps>(function FilterCheck(
  { type = 'checkbox', label, mutedLabel = false, count, tone = 'neutral', className = '', ...props },
  ref,
): ReactElement {
  const classes = ['filter-check', tone !== 'neutral' ? `filter-check--${tone}` : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <label className={classes}>
      <input ref={ref} type={type} {...props} />
      <span
        className={['filter-check__label', mutedLabel ? 'filter-check__label--muted' : '']
          .filter(Boolean)
          .join(' ')}
      >
        {label}
      </span>
      {count !== undefined ? <span className="filter-check__count">{count}</span> : null}
    </label>
  );
});

/** Vertical stack of `FilterCheck` rows; `scroll` caps it for long vocabularies. */
export function FilterChecks({
  children,
  scroll = false,
  role,
  'aria-label': ariaLabel,
}: {
  children: ReactNode;
  scroll?: boolean;
  role?: 'group' | 'radiogroup';
  'aria-label'?: string;
}): ReactElement {
  return (
    <div
      className={['filter-checks', scroll ? 'filter-checks--scroll' : ''].filter(Boolean).join(' ')}
      role={role}
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}
