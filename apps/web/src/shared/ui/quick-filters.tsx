/**
 * Quick Filters row (#3507)
 *
 * One labelled row of one-click `Chip` toggles ("NEEDS A LOOK · …  | PHASE ·
 * …"), the always-visible companion of a collapsed `FilterPanel`. Labels are
 * mono-caps like `.filter-bar__label`; a hairline separator splits groups; an
 * optional `end` slot sits flush right (and is dropped on a phone, where the
 * row becomes a single horizontally scrolling strip).
 *
 * @module shared/ui
 */
import type { ReactElement, ReactNode } from 'react';

export interface QuickFiltersProps {
  'aria-label': string;
  children: ReactNode;
  end?: ReactNode;
  className?: string;
}

export function QuickFilters({
  'aria-label': ariaLabel,
  children,
  end,
  className = '',
}: QuickFiltersProps): ReactElement {
  return (
    <div className={['quick-filters', className].filter(Boolean).join(' ')} role="group" aria-label={ariaLabel}>
      {children}
      {end ? <span className="quick-filters__end">{end}</span> : null}
    </div>
  );
}

export function QuickFiltersLabel({ children }: { children: ReactNode }): ReactElement {
  return <span className="quick-filters__label">{children}</span>;
}

export function QuickFiltersSeparator(): ReactElement {
  return <span className="quick-filters__sep" aria-hidden="true" />;
}
