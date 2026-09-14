/**
 * BulkAcceptPriceChangesDialog (#3148, ADR-072)
 *
 * A mini-row per included item, one "also set to Automatic" checkbox per
 * DISTINCT (source, connection) pair (never per item, never per connection
 * alone), and the rate-limit / no-retroactive-order disclaimer.
 *
 * The opt-in checkboxes are admin-only, matching `AcceptPriceChangeDialog`
 * (#3148 review, finding 2) — the Undo they each offer calls the admin-only
 * `PATCH /connections/:id/pricing-sync`, so a non-admin session never sees
 * an affordance it couldn't revert.
 *
 * @module apps/web/src/features/price-changes/components
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '../../../shared/ui/dialog';
import { Button } from '../../../shared/ui/button';
import { formatAmount } from '../../../shared/format/format-amount';
import { useIsAdmin } from '../../../shared/auth/use-permission';
import type { PriceChangeItem } from '../api/price-changes.types';
import { initialsFor } from '../lib/price-change-copy';

interface BulkAcceptPriceChangesDialogProps {
  items: PriceChangeItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isConfirming?: boolean;
  onConfirm: (optInPairs: Set<string>) => void;
}

function pairKey(item: PriceChangeItem): string {
  return `${item.sourceConnectionId}:${item.destinationConnectionId}`;
}

export function BulkAcceptPriceChangesDialog({
  items,
  open,
  onOpenChange,
  isConfirming = false,
  onConfirm,
}: BulkAcceptPriceChangesDialogProps): ReactElement {
  const [optInPairs, setOptInPairs] = useState<Set<string>>(new Set());
  const isAdmin = useIsAdmin();

  const distinctPairs = useMemo(() => {
    const seen = new Map<string, PriceChangeItem>();
    for (const item of items) {
      const key = pairKey(item);
      if (!seen.has(key)) seen.set(key, item);
    }
    return Array.from(seen.entries());
  }, [items]);

  const destinationCount = new Set(items.map((i) => i.destinationConnectionId)).size;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setOptInPairs(new Set());
        onOpenChange(next);
      }}
    >
      <DialogContent className="dialog__content--wide">
        <DialogTitle>Publish {items.length} price changes</DialogTitle>
        <DialogDescription>Going out to {destinationCount} connections.</DialogDescription>
        <div className="mini-list">
          {items.map((item) => (
            <div className="mini-row" key={item.id}>
              <span className="thumb" aria-hidden="true">
                {initialsFor(item.productName)}
              </span>
              <div className="mini-row__text">
                <div className="mini-row__name">{item.productName}</div>
                <div className="mini-row__meta">
                  {item.destinationLabel} · {item.sourceLabel}
                </div>
              </div>
              <div className="mini-row__price">
                {item.computedOldAmount === null ? null : (
                  <s>{formatAmount(item.computedOldAmount, item.destinationCurrency ?? undefined)}</s>
                )}
                {formatAmount(item.computedNewAmount, item.destinationCurrency ?? undefined)}
              </div>
            </div>
          ))}
        </div>
        {isAdmin ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {distinctPairs.map(([key, item]) => (
              <label className="opt-in-check" key={key}>
                <input
                  type="checkbox"
                  checked={optInPairs.has(key)}
                  onChange={(e) => {
                    setOptInPairs((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(key);
                      else next.delete(key);
                      return next;
                    });
                  }}
                />
                <span>
                  <span className="opt-in-check__title">
                    Also set {item.sourceLabel} → {item.destinationLabel} to Automatic
                  </span>
                </span>
              </label>
            ))}
          </div>
        ) : null}
        <p className="rule-note rule-note--muted">
          We&apos;ll send these one at a time so we don&apos;t overwhelm any channel — you&apos;ll see
          progress once you confirm. This never touches the price of an order that&apos;s already
          been placed.
        </p>
        <DialogFooter>
          <Button tone="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={isConfirming} onClick={() => onConfirm(optInPairs)}>
            {isConfirming ? 'Publishing…' : 'Publish prices'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
