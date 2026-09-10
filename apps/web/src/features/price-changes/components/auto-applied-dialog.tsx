/**
 * AutoAppliedDialog (#3151, ADR-072 decision 3)
 *
 * "Applied automatically today" — mirrors
 * `docs/plans/mockups/price-changes-review-queue.html`'s
 * `#dialog-auto-applied`. Reuses the same `.mini-list`/`.mini-row` shape the
 * bulk-accept dialog (#3148) already renders — not a new list component.
 *
 * Deliberately NOT paginated, filterable, or a dedicated page/route — the
 * entire scope of the "Daily digest" mode ADR-072 decision 3 cut. If a real
 * need for more surfaces later, that is new design work, not an extension
 * of this component.
 *
 * @module apps/web/src/features/price-changes/components
 */
import type { ReactElement } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '../../../shared/ui/dialog';
import { Button } from '../../../shared/ui/button';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { formatAmount } from '../../../shared/format/format-amount';
import type { PriceChangeAutoAppliedItem } from '../api/price-changes.types';

export interface AutoAppliedRow {
  item: PriceChangeAutoAppliedItem;
  /** The variant/product label — falls back to the SKU or the bare id when a variant lookup fails or is still loading. */
  label: string;
  destinationLabel: string;
}

export interface AutoAppliedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: readonly AutoAppliedRow[];
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function AutoAppliedDialog({ open, onOpenChange, rows }: AutoAppliedDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Applied automatically today</DialogTitle>
        <DialogDescription>
          These connections publish without asking, so nothing here needs a decision from you.
        </DialogDescription>
        <div className="mini-list" id="dialog-auto-applied-list">
          {rows.map(({ item, label, destinationLabel }) => (
            <div className="mini-row" key={item.id}>
              <span className="thumb" style={{ width: 24, height: 24, fontSize: 10 }} aria-hidden="true">
                {initials(label)}
              </span>
              <div className="mini-row__text">
                <div className="mini-row__name">{label}</div>
                <div className="mini-row__meta">
                  {destinationLabel} · <TimeDisplay iso={item.appliedAt} format="relative" />
                </div>
              </div>
              <div className="mini-row__price">
                <s>{formatAmount(item.oldAmount, item.currency)}</s>
                {formatAmount(item.newAmount, item.currency)}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button tone="secondary" id="dialog-auto-applied-close" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
