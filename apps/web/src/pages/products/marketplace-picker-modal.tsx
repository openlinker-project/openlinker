/**
 * MarketplacePickerModal
 *
 * Capability-gated publish-destination picker shown from the Products page
 * when 2+ eligible connections exist (#1096, widened for the unified publish
 * flow in #1828). Renders the shared `PublishDestinationRail` (grouped by kind
 * with a capability-driven hint, keyboard-navigable single-select); choosing
 * one continues with that connection preselected.
 *
 * @module pages/products
 */
import { useEffect, useState, type ReactElement } from 'react';

import { Button } from '../../shared/ui';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../shared/ui/dialog';
import { PublishDestinationRail, type PublishDestination } from '../../features/listings';
import { captureDemoEvent } from '../../features/demo';

interface MarketplacePickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productCount: number;
  destinations: readonly PublishDestination[];
  onContinue: (connectionId: string) => void;
}

export function MarketplacePickerModal({
  open,
  onOpenChange,
  productCount,
  destinations,
  onContinue,
}: MarketplacePickerModalProps): ReactElement {
  const [picked, setPicked] = useState<string>('');

  // Reset the draft pick every time the modal closes.
  useEffect(() => {
    if (!open) setPicked('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Where should these publish?</DialogTitle>
        <DialogDescription>
          Publishing <strong>{productCount.toLocaleString()}</strong>{' '}
          {productCount === 1 ? 'product' : 'products'}. Pick the marketplace or shop to publish
          them to.
        </DialogDescription>

        <PublishDestinationRail
          destinations={destinations}
          selectedConnectionId={picked || null}
          onSelect={setPicked}
          ariaLabel="Publish destination"
        />

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
                const platform =
                  destinations.find((d) => d.connection.id === picked)?.connection.platformType ??
                  picked;
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
