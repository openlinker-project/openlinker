/**
 * PricingRulesPickerDialog (#3150, ADR-072)
 *
 * "Which connection's rules do you want to see" — mirrors
 * `docs/plans/mockups/price-changes-review-queue.html`'s `#dialog-picker`.
 * Lists every DESTINATION connection (rules live on destinations, per ADR
 * decision 2), each row navigating to that destination's dedicated Pricing
 * & sync page on click.
 *
 * @module apps/web/src/features/price-changes/components
 */
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '../../../shared/ui/dialog';
import { Button } from '../../../shared/ui/button';
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
  const navigate = useNavigate();
  const connectionIds = destinationConnections.map((c) => c.id);
  const summaries = useDestinationPricingSyncSummaries(connectionIds);

  function goTo(connectionId: string): void {
    onOpenChange(false);
    void navigate(`/connections/${connectionId}/pricing-sync`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Pricing rules</DialogTitle>
        <DialogDescription>Choose a connection to see how it prices your products.</DialogDescription>
        <div className="mini-list" id="dialog-picker-list">
          {destinationConnections.map((connection, index) => {
            const summary = summaries[index]?.data;
            const overrideCount = summary?.sources.filter((s) => s.isCustomOverride).length ?? 0;
            return (
              <div
                key={connection.id}
                id={`picker-conn-${connection.id}`}
                className="mini-row"
                style={{ cursor: 'pointer' }}
                role="button"
                tabIndex={0}
                onClick={() => goTo(connection.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') goTo(connection.id);
                }}
              >
                <div className="mini-row__text">
                  <div className="mini-row__name">{connection.name}</div>
                  <div className="mini-row__meta">
                    {summary ? (
                      <>
                        Default: {summary.default.mode === 'automatic' ? 'Automatic' : 'Manual review'} ·{' '}
                        {ruleLabelFor(summary.default.rule)}
                        {overrideCount > 0
                          ? ` · ${overrideCount} source${overrideCount === 1 ? '' : 's'} with a different rule`
                          : ''}
                      </>
                    ) : (
                      'Loading…'
                    )}
                  </div>
                </div>
                <Button
                  tone="secondary"
                  className="button--xs"
                  id={`picker-open-${connection.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    goTo(connection.id);
                  }}
                >
                  Open
                </Button>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button tone="secondary" id="dialog-picker-cancel" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
