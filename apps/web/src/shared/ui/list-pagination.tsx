/**
 * List Pagination (#2945)
 *
 * The presentational half of the two-stage total. Renders the range summary
 * and the page controls for a list whose total arrives AFTER its rows.
 *
 * **Pagination degrades per affordance, never as a block.** Disabling the whole
 * pager until the total lands would throw away most of the benefit, so each
 * control is wired to what it actually needs:
 *
 * | Control                 | Needs the total |
 * |-------------------------|-----------------|
 * | Previous                | no  - `offset > 0` is enough                |
 * | Next                    | no  - a full page means more may follow     |
 * | "of 1,234"              | yes - shows the `N+` placeholder until then |
 * | Page numbers, jump-to-last | yes - not rendered by any list today; a list that grows them must gate them on `total !== null`, NOT on this component being present |
 *
 * **The placeholder is `N+`, never a skeleton.** A skeleton says content is
 * coming; the rows are already on screen and only a number is missing, so a
 * skeleton would make the page read as slower than it is.
 *
 * **A failed count leaves the placeholder, and never renders `0`.** Absence and
 * "none matched" are different claims, and only one of them is safe to make
 * from a failed read.
 *
 * @module shared/ui
 * @see shared/hooks/use-paginated-total for the data half
 */
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { Button } from './button';
import type { PaginatedTotalState } from '../hooks/use-paginated-total';

export interface ListPaginationProps extends ComponentPropsWithoutRef<'div'> {
  /** Zero-based index of the first row on this page. */
  offset: number;
  /** Page size requested. */
  limit: number;
  /** Rows actually returned for this page. */
  rowCount: number;
  /** The exact total, or `null` when it is not known yet. Never pass `0` for unknown. */
  total: number | null;
  /** What the second stage is doing, from `usePaginatedTotal`. */
  totalState: PaginatedTotalState;
  /** Whether to render the counting affordance, from `usePaginatedTotal`. */
  showTotalLoader: boolean;
  onOffsetChange: (nextOffset: number) => void;
}

export const ListPagination = forwardRef<HTMLDivElement, ListPaginationProps>(
  function ListPagination(
    {
      offset,
      limit,
      rowCount,
      total,
      totalState,
      showTotalLoader,
      onOffsetChange,
      className,
      ...rest
    },
    ref,
  ) {
    const hasPrev = offset > 0;
    // Needs no total: a page that came back FULL may have more behind it, and a
    // short page provably does not. Once the total lands it takes over, which
    // is strictly more accurate at the boundary where a full last page has
    // exactly zero rows after it.
    const hasNext = total !== null ? offset + limit < total : rowCount === limit;

    const totalUnavailable = totalState === 'unavailable';

    return (
      <div
        ref={ref}
        className={['pagination', className].filter(Boolean).join(' ')}
        {...rest}
      >
        <span className="text-muted" aria-busy={showTotalLoader || undefined}>
          {rowCount === 0 ? (
            'No results'
          ) : (
            <>
              Showing {(offset + 1).toLocaleString()}&ndash;
              {(offset + rowCount).toLocaleString()} of{' '}
              {total !== null ? (
                <span className="tabular">{total.toLocaleString()}</span>
              ) : (
                <span
                  className="tabular pagination__total-pending"
                  title={
                    totalUnavailable
                      ? 'The full count could not be loaded. At least this many match.'
                      : 'Counting the full result set'
                  }
                >
                  {(offset + rowCount).toLocaleString()}+
                  {showTotalLoader ? (
                    <span className="pagination__counting-dot" aria-hidden="true" />
                  ) : null}
                </span>
              )}
            </>
          )}
        </span>
        <div className="pagination__actions">
          <Button
            disabled={!hasPrev}
            onClick={() => {
              onOffsetChange(Math.max(0, offset - limit));
            }}
          >
            Previous
          </Button>
          <Button
            disabled={!hasNext}
            onClick={() => {
              onOffsetChange(offset + limit);
            }}
          >
            Next
          </Button>
        </div>
      </div>
    );
  },
);
