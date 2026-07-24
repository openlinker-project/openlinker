/**
 * MarketplacePickerModal
 *
 * Capability-gated publish-destination picker shown from the Products page
 * when 2+ eligible connections exist (#1096, widened for the unified publish
 * flow in #1828). Lists each destination grouped by kind (Marketplaces /
 * Online shops) with a capability-driven hint - never a `platformType`
 * literal; choosing one continues with that connection preselected.
 *
 * Selection is single-select and capability-based. Display names come from
 * the connection record; the kind hint comes from `publishDestinationKind`.
 *
 * @module pages/products
 */
import { Fragment, useEffect, useState, type ReactElement } from 'react';

import { Button } from '../../shared/ui';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../shared/ui/dialog';
import {
  PUBLISH_DESTINATION_GROUP_LABEL,
  PUBLISH_DESTINATION_KIND_HINT,
  PUBLISH_DESTINATION_KIND_ORDER,
  type PublishDestination,
} from '../../features/listings';

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

        <div role="radiogroup" aria-label="Publish destination" className="marketplace-picker">
          {PUBLISH_DESTINATION_KIND_ORDER.map((kind) => {
            const inKind = destinations.filter((d) => d.kind === kind);
            if (inKind.length === 0) return null;
            return (
              <Fragment key={kind}>
                <div className="marketplace-picker__group">
                  {PUBLISH_DESTINATION_GROUP_LABEL[kind]}
                </div>
                {inKind.map((d) => {
                  const isPicked = picked === d.connection.id;
                  return (
                    <button
                      key={d.connection.id}
                      type="button"
                      role="radio"
                      aria-checked={isPicked}
                      className={`marketplace-picker__option${isPicked ? ' marketplace-picker__option--picked' : ''}`}
                      onClick={() => setPicked(d.connection.id)}
                    >
                      <span className="marketplace-picker__meta">
                        <span className="marketplace-picker__name">{d.connection.name}</span>
                        <span className="mono-text muted-text">
                          {PUBLISH_DESTINATION_KIND_HINT[d.kind]}
                        </span>
                      </span>
                      <span className="marketplace-picker__radio" aria-hidden="true" />
                    </button>
                  );
                })}
              </Fragment>
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
              onClick={() => picked && onContinue(picked)}
            >
              Continue →
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
