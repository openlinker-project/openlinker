/**
 * DataTableSkeleton
 *
 * Shimmer placeholder that mirrors the shape of `DataTable` during its initial
 * loading phase. Replaces the centered `LoadingState` card on list pages so
 * there is no layout shift when data arrives.
 *
 * Above 768px it renders a table skeleton; below that it renders a stack of
 * card skeletons so the mobile card view can swap in without reflow.
 *
 * @module shared/ui
 * @see {@link DataTable} for the real table whose shape this mirrors
 */
import type { ReactElement } from 'react';
import type { DataTableHideBreakpoint } from './data-table';
import { useMediaQuery } from './use-media-query';

/**
 * Narrow shape the skeleton cares about: only `hideBelow` drives rendering.
 * `DataTableColumn<Row>` is structurally assignable to this for any `Row`,
 * so callers can pass their existing `COLUMNS` array without casts.
 */
export interface DataTableSkeletonColumn {
  hideBelow?: DataTableHideBreakpoint;
}

export interface DataTableSkeletonProps {
  /**
   * Either a plain column count, or the column array passed to `DataTable`.
   * Passing the array lets the skeleton honour each column's `hideBelow` so
   * intermediate widths match the real table's visible columns.
   */
  columns: number | readonly DataTableSkeletonColumn[];
  rows?: number;
}

const DEFAULT_ROWS = 8;

function normalizeColumns(
  columns: DataTableSkeletonProps['columns'],
): DataTableSkeletonColumn[] {
  if (typeof columns === 'number') {
    return Array.from({ length: Math.max(0, columns) }, () => ({}));
  }
  return columns.map((column) => ({ hideBelow: column.hideBelow }));
}

function cellClass(column: DataTableSkeletonColumn): string | undefined {
  return column.hideBelow ? `data-table__cell--hide-below-${column.hideBelow}` : undefined;
}

export function DataTableSkeleton({
  columns,
  rows = DEFAULT_ROWS,
}: DataTableSkeletonProps): ReactElement {
  const normalized = normalizeColumns(columns);
  const isMobile = useMediaQuery('(max-width: 767.98px)');

  return (
    <div
      className="data-table-skeleton"
      role="status"
      aria-live="polite"
      aria-label="Loading table data"
    >
      <span className="sr-only">Loading…</span>
      {isMobile ? (
        <ul className="data-table-skeleton__cards" aria-hidden="true">
          {Array.from({ length: rows }, (_, rowIndex) => (
            <li key={rowIndex} className="data-table-skeleton__card">
              <span className="data-table-skeleton__bar data-table-skeleton__bar--title" />
              <span className="data-table-skeleton__bar data-table-skeleton__bar--subtitle" />
            </li>
          ))}
        </ul>
      ) : (
        <div className="data-table__container" aria-hidden="true">
          <table className="data-table-skeleton__table">
            <thead>
              <tr>
                {normalized.map((column, columnIndex) => (
                  <th key={columnIndex} className={cellClass(column)}>
                    <span className="data-table-skeleton__bar data-table-skeleton__bar--header" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }, (_, rowIndex) => (
                <tr key={rowIndex} className="data-table-skeleton__row">
                  {normalized.map((column, columnIndex) => (
                    <td key={columnIndex} className={cellClass(column)}>
                      <span className="data-table-skeleton__bar" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
