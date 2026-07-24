/**
 * MarketplacePickerModal
 *
 * Capability-gated marketplace picker shown from the Products page when 2+
 * `OfferManager` connections exist (#1096). Lists each eligible connection
 * (name + platform + adapterKey + `OfferManager` badge); choosing one
 * continues to the bulk wizard with that connection preselected.
 *
 * Selection is capability-based — there is no literal `platformType ===` here.
 * Display names resolve through `usePlatforms()`.
 *
 * @module pages/products
 */
import { useEffect, useState, type ReactElement } from 'react';

import { Button, StatusBadge } from '../../shared/ui';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../shared/ui/dialog';
import { usePlatforms } from '../../shared/plugins';
import type { Connection } from '../../features/connections';
import { captureDemoEvent } from '../../features/demo';

interface MarketplacePickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productCount: number;
  connections: readonly Connection[];
  onContinue: (connectionId: string) => void;
}

export function MarketplacePickerModal({
  open,
  onOpenChange,
  productCount,
  connections,
  onContinue,
}: MarketplacePickerModalProps): ReactElement {
  const platforms = usePlatforms();
  const [picked, setPicked] = useState<string>('');

  // Reset the draft pick every time the modal closes.
  useEffect(() => {
    if (!open) setPicked('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Where should these list?</DialogTitle>
        <DialogDescription>
          Creating offers for <strong>{productCount.toLocaleString()}</strong>{' '}
          {productCount === 1 ? 'product' : 'products'}. Pick the marketplace connection to create
          them on.
        </DialogDescription>

        <div role="radiogroup" aria-label="Marketplace connection" className="marketplace-picker">
          {connections.map((c) => {
            const displayName =
              platforms.find((p) => p.platformType === c.platformType)?.displayName ??
              c.platformType;
            const isPicked = picked === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={isPicked}
                className={`marketplace-picker__option${isPicked ? ' marketplace-picker__option--picked' : ''}`}
                onClick={() => setPicked(c.id)}
              >
                <span className="marketplace-picker__meta">
                  <span className="marketplace-picker__name">{c.name}</span>
                  <span className="mono-text muted-text">
                    {c.adapterKey ?? c.platformType} · {displayName}
                  </span>
                </span>
                <StatusBadge tone="info" compact>
                  OfferManager
                </StatusBadge>
              </button>
            );
          })}
        </div>

        <div className="wizard-actions">
          <div className="wizard-actions__group">
            <Button tone="ghost" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
          <div className="wizard-actions__group">
            <Button
              type="button"
              tone="primary"
              disabled={!picked}
              onClick={() => {
                if (!picked) return;
                const platform = connections.find((c) => c.id === picked)?.platformType ?? picked;
                captureDemoEvent('demo_offer_marketplace_picked', { platform });
                onContinue(picked);
              }}
            >
              Continue →
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
