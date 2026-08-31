/**
 * Coverage Detail Dialog
 *
 * The shared modal shell behind all five Data Coverage drill-downs
 * (`detail-currency` / `detail-tax` / `detail-novat` / `detail-postrollout` /
 * `detail-mapping`, #2474 Phase 7). One primitive rather than five
 * near-duplicate dialogs — each category supplies its own row renderer and
 * footer action; this owns only the loading/error/empty states, the row
 * list shell, and REAL pagination (never a "View more →" link — one of the
 * mini-epic's own regression guards, caught twice in the mockup's own
 * design review).
 *
 * @module apps/web/src/features/analytics/components
 */
import type { ReactElement, ReactNode } from 'react';
import { Button } from '../../../shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '../../../shared/ui/dialog';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';

export interface CoverageDetailDialogProps<T> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  items: T[];
  total: number;
  limit: number;
  offset: number;
  onOffsetChange: (offset: number) => void;
  renderRow: (item: T) => ReactNode;
  rowKey: (item: T) => string;
  emptyMessage?: string;
  /** Rendered beside "Close" in the footer — the category's own write action. */
  footerAction?: ReactNode;
}

export function CoverageDetailDialog<T>({
  open,
  onOpenChange,
  title,
  description,
  isLoading,
  error,
  onRetry,
  items,
  total,
  limit,
  offset,
  onOffsetChange,
  renderRow,
  rowKey,
  emptyMessage = 'Nothing here anymore.',
  footerAction,
}: CoverageDetailDialogProps<T>): ReactElement {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-label={title} className="dialog__content--wide">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>

        {isLoading ? (
          <LoadingState title="Loading" message="Fetching the affected orders…" />
        ) : error ? (
          <ErrorState
            title="Unable to load orders"
            message={error.message}
            action={
              <Button type="button" onClick={onRetry}>
                Retry
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <p className="text-muted">{emptyMessage}</p>
        ) : (
          <>
            <div className="coverage-detail__table-wrap">
              <ul className="coverage-detail-row-list">
                {items.map((item) => (
                  <li className="coverage-detail-row" key={rowKey(item)}>
                    {renderRow(item)}
                  </li>
                ))}
              </ul>
            </div>
            <div className="pagination">
              <span className="text-muted mono-text">
                Showing {from}–{to} of {total}
              </span>
              <div className="pagination__actions">
                <Button
                  type="button"
                  tone="secondary"
                  className="button--sm"
                  disabled={!hasPrev}
                  onClick={() => onOffsetChange(Math.max(0, offset - limit))}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  tone="secondary"
                  className="button--sm"
                  disabled={!hasNext}
                  onClick={() => onOffsetChange(offset + limit)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}

        <DialogFooter>
          <Button type="button" tone="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {footerAction}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
