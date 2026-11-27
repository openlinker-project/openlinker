/**
 * SortArrow, SortField, SortStack
 *
 * The sort affordance of a table header. A field is quiet until it is the
 * active sort: then its text turns accent, a 2px underline grows in from the
 * start edge and the arrow settles with a small spring, turning 180 degrees for
 * descending. Transform and opacity only, so the motion costs no layout.
 * `prefers-reduced-motion` switches all of it off in index.css.
 *
 * `SortStack` lays several fields out one above another, for a stacked column
 * whose cell shows more than one sortable field.
 *
 * @module shared/ui
 */
import type { ReactElement, ReactNode } from 'react';

export type SortDirectionValue = 'asc' | 'desc';

export function SortArrow({
  active = false,
  dir = 'asc',
}: {
  active?: boolean;
  dir?: SortDirectionValue;
}): ReactElement {
  const classes = ['sort-arrow', active ? 'sort-arrow--on' : '', active && dir === 'desc' ? 'sort-arrow--desc' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes} aria-hidden="true">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 8.5V1.5M2 4.5l3-3 3 3" />
      </svg>
    </span>
  );
}

export interface SortFieldProps {
  label: ReactNode;
  active: boolean;
  dir: SortDirectionValue;
  onClick: () => void;
  /** Full accessible name, including the current state, e.g. "Total, sorted ascending". */
  ariaLabel: string;
}

export function SortField({ label, active, dir, onClick, ariaLabel }: SortFieldProps): ReactElement {
  return (
    <button
      type="button"
      className={['sort-field', active ? 'sort-field--active' : ''].filter(Boolean).join(' ')}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      <span className="sort-field__text">{label}</span>
      <SortArrow active={active} dir={dir} />
    </button>
  );
}

/** A header label that cannot sort, aligned with its sortable neighbours. */
export function StaticSortLabel({ label }: { label: ReactNode }): ReactElement {
  return <span className="sort-field sort-field--static">{label}</span>;
}

export function SortStack({
  children,
  end = false,
}: {
  children: ReactNode;
  end?: boolean;
}): ReactElement {
  return <span className={['sort-stack', end ? 'sort-stack--end' : ''].filter(Boolean).join(' ')}>{children}</span>;
}
