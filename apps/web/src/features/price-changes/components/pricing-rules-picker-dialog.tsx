/**
 * PricingRulesPickerDialog (#3150, ADR-072)
 *
 * "Which connection's rules do you want to see" — mirrors
 * `docs/plans/mockups/price-changes-review-queue.html`'s `#dialog-picker`.
 * Lists every DESTINATION connection (rules live on destinations, per ADR
 * decision 2), each row navigating to that destination's dedicated Pricing
 * & sync page on click.
 *
 * **#3167 review fixes rolled in here.** (Finding 4a) A row's summary is
 * branched on the query's own `status`, not on `data` alone — `data` is
 * `undefined` on BOTH a still-loading and a permanently-FAILED query, so
 * reading only `data` rendered "Loading…" forever for a row whose read
 * genuinely failed, and silently asserted "no overrides" (`?? 0`) about a
 * connection whose config couldn't even be read. A zero-destination result
 * now also renders a real `EmptyState` instead of an empty `.mini-list`.
 * (Finding 4b) The row is no longer a `role="button"` wrapper around a real
 * `<Button>` — the `bulk-review-step.tsx` / `read-only-lock.tsx` ARIA
 * nested-interactive fix applied here too — and "Open" is a real
 * navigation `<Link>` rather than a click handler, so Ctrl/Cmd-click,
 * middle-click, and "open in new tab" all work.
 *
 * @module apps/web/src/features/price-changes/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '../../../shared/ui/dialog';
import { Button } from '../../../shared/ui/button';
import { EmptyState } from '../../../shared/ui/feedback-state';
import { useDestinationPricingSyncSummaries } from '../hooks/use-destination-pricing-sync-summaries';
import { ruleLabelFor } from '../lib/price-change-copy';
import type { Connection } from '../../connections';

export interface PricingRulesPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destinationConnections: readonly Connection[];
}

export function PricingRulesPickerDialog({
  open,
  onOpenChange,
  destinationConnections,
}: PricingRulesPickerDialogProps): ReactElement {
  const connectionIds = destinationConnections.map((c) => c.id);
  // Gated on `open` (#3167 review, finding 3) — this dialog is mounted
  // unconditionally by the queue table, so without this every render of the
  // Price changes tab fired one request per destination connection.
  const summaries = useDestinationPricingSyncSummaries(connectionIds, { enabled: open });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Pricing rules</DialogTitle>
        <DialogDescription>Choose a connection to see how it prices your products.</DialogDescription>
        {destinationConnections.length === 0 ? (
          <EmptyState
            title="No pricing destinations yet"
            message="Enable OfferManager or ProductPublisher on a connection to give it its own pricing rule."
          />
        ) : (
          <div className="mini-list" id="dialog-picker-list">
            {destinationConnections.map((connection, index) => {
              const summaryQuery = summaries[index];
              const overrideCount =
                summaryQuery?.data?.sources.filter((s) => s.isCustomOverride).length ?? 0;
              return (
                <div key={connection.id} id={`picker-conn-${connection.id}`} className="mini-row">
                  <div className="mini-row__text">
                    <div className="mini-row__name">{connection.name}</div>
                    <div className="mini-row__meta">
                      {summaryQuery?.status === 'success' && summaryQuery.data ? (
                        <>
                          Default:{' '}
                          {summaryQuery.data.default.mode === 'automatic'
                            ? 'Automatic'
                            : 'Manual review'}{' '}
                          · {ruleLabelFor(summaryQuery.data.default.rule)}
                          {overrideCount > 0
                            ? ` · ${overrideCount} source${overrideCount === 1 ? '' : 's'} with a different rule`
                            : ''}
                        </>
                      ) : summaryQuery?.status === 'error' ? (
                        "Couldn't load this connection's rule."
                      ) : (
                        'Loading…'
                      )}
                    </div>
                  </div>
                  <Link
                    className="button button--secondary button--xs"
                    id={`picker-open-${connection.id}`}
                    to={`/connections/${connection.id}/pricing-sync`}
                    onClick={() => onOpenChange(false)}
                  >
                    Open
                  </Link>
                </div>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button tone="secondary" id="dialog-picker-cancel" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
