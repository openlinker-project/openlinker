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
 * **The row's shape is declared, not assumed (#2538, closing #2152).** The
 * skeleton used to render a fixed 36px row while several shipped tables use
 * two-line identity cells, so the table grew on load - the layout shift this
 * component exists to prevent, in the component meant to prevent it. A column
 * now says how many text lines its cell renders at its tallest, and the
 * skeleton stacks that many bars, so the height comes out of the same content
 * the real row is built from rather than a number copied beside it. `rowAction`
 * does the same for a row that can carry a control: the worst case is taken,
 * because a table where only some rows carry an action must not resize when it
 * turns out that they do.
 *
 * @module shared/ui
 * @see {@link DataTable} for the real table whose shape this mirrors
 */
import type { ReactElement } from 'react';
import type { DataTableHideBreakpoint } from './data-table';
import { useMediaQuery } from './use-media-query';

/**
 * Narrow shape the skeleton cares about: `hideBelow` drives which cells are
 * rendered at which width, `lines` drives the row's height.
 * `DataTableColumn<Row>` is structurally assignable to this for any `Row`,
 * so callers can pass their existing `COLUMNS` array without casts.
 */
export interface DataTableSkeletonColumn {
  hideBelow?: DataTableHideBreakpoint;
  /**
   * How many text lines this column's cell renders at its tallest. Defaults to
   * 1. An identity cell that stacks a title over a meta line declares 2.
   */
  lines?: number;
}

export interface DataTableSkeletonProps {
  /**
   * Either a plain column count, or the column array passed to `DataTable`.
   * Passing the array lets the skeleton honour each column's `hideBelow` so
   * intermediate widths match the real table's visible columns, and its
   * `lines` so the row reserves the height the loaded row will take.
   */
  columns: number | readonly DataTableSkeletonColumn[];
  rows?: number;
  /**
   * The row can carry an action control. Reserves its height on EVERY row,
   * since a table where only some rows carry one would otherwise resize when
   * they arrive.
   */
  rowAction?: boolean;
  /**
   * What is loading, in words. Announced in place of the generic default, so a
   * page with two loading regions does not say "Loading" twice.
   */
  label?: string;
}

const DEFAULT_ROWS = 8;
const DEFAULT_LINES = 1;

function normalizeColumns(columns: DataTableSkeletonProps['columns']): DataTableSkeletonColumn[] {
  if (typeof columns === 'number') {
    return Array.from({ length: Math.max(0, columns) }, () => ({}));
  }
  return columns.map((column) => ({ hideBelow: column.hideBelow, lines: column.lines }));
}

function cellClass(column: DataTableSkeletonColumn): string | undefined {
  return column.hideBelow ? `data-table__cell--hide-below-${column.hideBelow}` : undefined;
}

/** At least one line; a fractional or negative declaration is not a shape. */
function lineCount(column: DataTableSkeletonColumn): number {
  const declared = column.lines ?? DEFAULT_LINES;
  return Number.isFinite(declared) ? Math.max(1, Math.floor(declared)) : DEFAULT_LINES;
}

export function DataTableSkeleton({
  columns,
  rows = DEFAULT_ROWS,
  rowAction = false,
  label = 'Loading…',
}: DataTableSkeletonProps): ReactElement {
  const normalized = normalizeColumns(columns);
  const isMobile = useMediaQuery('(max-width: 767.98px)');
  const tallestColumn = normalized.reduce((tallest, column) => Math.max(tallest, lineCount(column)), 1);
  const rowClasses = ['data-table-skeleton__row', rowAction ? 'data-table-skeleton__row--action' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className="data-table-skeleton" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {isMobile ? (
        <ul className="data-table-skeleton__cards" aria-hidden="true">
          {Array.from({ length: rows }, (_, rowIndex) => (
            <li key={rowIndex} className="data-table-skeleton__card">
              <span className="data-table-skeleton__bar data-table-skeleton__bar--title" />
              <span className="data-table-skeleton__bar data-table-skeleton__bar--subtitle" />
              {/* A card shows the row's whole field set, so a two-line desktop
                  cell means at least one more line here too. */}
              {tallestColumn > 1 ? (
                <span className="data-table-skeleton__bar data-table-skeleton__bar--subtitle" />
              ) : null}
              {rowAction ? (
                <span className="data-table-skeleton__bar data-table-skeleton__bar--action" />
              ) : null}
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
                <tr key={rowIndex} className={rowClasses}>
                  {normalized.map((column, columnIndex) => (
                    <td key={columnIndex} className={cellClass(column)}>
                      <span className="data-table-skeleton__stack">
                        {Array.from({ length: lineCount(column) }, (_, lineIndex) => (
                          <span
                            key={lineIndex}
                            className={
                              lineIndex === 0
                                ? 'data-table-skeleton__bar'
                                : 'data-table-skeleton__bar data-table-skeleton__bar--meta'
                            }
                          />
                        ))}
                      </span>
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
