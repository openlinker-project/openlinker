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
import { formatPaginatedTotal, type PaginatedTotalState } from '../hooks/use-paginated-total';

export interface ListPaginationProps extends ComponentPropsWithoutRef<'nav'> {
  /** Zero-based index of the first row on this page. */
  offset: number;
  /** Page size requested. */
  limit: number;
  /**
   * Rows actually returned for this page.
   *
   * **Precondition**: the page must have LOADED. `0` here means "no rows
   * matched", and is rendered as `No results` - it must never stand in for
   * "the rows have not arrived yet", which would print that over a spinner.
   * Every adopter today short-circuits to its own empty state before reaching
   * this component, so the branch is a guard rather than a live path.
   */
  rowCount: number;
  /** The exact total, or `null` when it is not known yet. Never pass `0` for unknown. */
  total: number | null;
  /** What the second stage is doing, from `usePaginatedTotal`. */
  totalState: PaginatedTotalState;
  /** Whether to render the counting affordance, from `usePaginatedTotal`. */
  showTotalLoader: boolean;
  onOffsetChange: (nextOffset: number) => void;
}

export const ListPagination = forwardRef<HTMLElement, ListPaginationProps>(function ListPagination(
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
  ref
) {
  const hasPrev = offset > 0;
  // Needs no total: a page that came back FULL may have more behind it, and a
  // short page provably does not. Once the total lands it takes over, which
  // is strictly more accurate at the boundary where a full last page has
  // exactly zero rows after it.
  // Next is enabled when the total says more follow, OR when the rows already
  // on screen OVERRUN the total (#2957 review round 5, I1).
  //
  // The second clause exists because the total and the page are now two
  // requests, and one predicate - `slaState` - binds its own `new Date()`, so
  // an order crossing `dispatchByAt` between them is in the rows and not in the
  // count. Gating on the total alone would then kill Next while the list is
  // still returning a full page, leaving rows the operator can see and cannot
  // reach.
  //
  // `>` and not `>=`, deliberately: at an exact multiple of the page size the
  // rows END at the total, which is agreement rather than skew, and enabling
  // Next there would send the operator to a blank page on every well-behaved
  // list. Only a page that runs PAST its own total is evidence the total is
  // stale, and that is the only case worth overruling it for.
  const hasNext =
    total !== null ? offset + limit < total || offset + rowCount > total : rowCount === limit;

  const totalUnavailable = totalState === 'unavailable';

  return (
    <nav
      ref={ref}
      aria-label="Pagination"
      className={['pagination', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {/*
          `aria-live` on the summary, not merely `aria-busy`: a busy flag on a
          non-live region announces nothing, so a screen-reader user would never
          learn that `20+` had become `1,234`. Polite, so it waits for a pause.
        */}
      <span className="text-muted" aria-live="polite" aria-busy={showTotalLoader || undefined}>
        {rowCount === 0 ? (
          'No results'
        ) : (
          <>
            Showing {(offset + 1).toLocaleString()}&ndash;
            {(offset + rowCount).toLocaleString()} of{' '}
            {total !== null ? (
              <span className="tabular">{formatPaginatedTotal(total, offset + rowCount)}</span>
            ) : (
              <span
                className="tabular pagination__total-pending"
                title={
                  totalUnavailable
                    ? 'The full count could not be loaded. At least this many match.'
                    : 'Counting the full result set'
                }
              >
                {formatPaginatedTotal(total, offset + rowCount)}
                {showTotalLoader ? (
                  <span className="pagination__counting-dot" aria-hidden="true" />
                ) : null}
              </span>
            )}
            {/*
                A FAILED count gets visible, machine-readable text - not just a
                `title`. The hook goes to real trouble to keep `unavailable`
                apart from `pending`, and a tooltip keeps neither promise: it is
                not reliably surfaced to a screen reader, never appears on
                touch, and needs a hover-and-wait on desktop. Without this the
                two states are indistinguishable to the operator, which makes
                the distinction a comment rather than a behaviour.
              */}
            {totalUnavailable ? (
              <span className="pagination__total-failed"> (count unavailable)</span>
            ) : null}
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
    </nav>
  );
});
