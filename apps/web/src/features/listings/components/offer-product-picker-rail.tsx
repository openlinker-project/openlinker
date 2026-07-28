/**
 * OfferProductPickerRail
 *
 * The right-hand (desktop) / step-2 (mobile) review rail of
 * `OfferProductPickerModal` (#1819 extraction, unchanged behaviour): "In this
 * batch" counts, per-product selection groups with status chips + remove
 * actions, the destination picker (`PublishDestinationRail`), and the
 * Cancel / Continue actions.
 *
 * @module apps/web/src/features/listings/components
 */
import type { ReactElement, RefObject } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ProductThumbnail } from '../../../shared/ui/product-thumbnail';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../shared/ui/tooltip';
import type { PublishDestination, PublishDestinationKind } from '../lib/publish-destinations';
import { PublishDestinationRail } from './publish-destination-rail';
import type { RailGroup } from './offer-product-picker.types';

interface OfferProductPickerRailProps {
  railBackRef: RefObject<HTMLButtonElement | null>;
  onBack: () => void;
  railGroups: RailGroup[];
  itemCount: number;
  needEanCount: number;
  selectionSize: number;
  onClearSelection: () => void;
  onRemoveProduct: (productId: string) => void;
  onRemoveVariant: (productId: string, variantId: string) => void;
  connectionsLoading: boolean;
  connectionsError: Error | null;
  onRetryConnections: () => void;
  eligibleDestinations: PublishDestination[];
  resolvedConnectionId: string | null;
  resolvedKind: PublishDestinationKind | null;
  onSelectConnection: (connectionId: string) => void;
  canContinue: boolean;
  onContinue: () => void;
  onCancel: () => void;
  selectionSummary: string;
}

export function OfferProductPickerRail({
  railBackRef,
  onBack,
  railGroups,
  itemCount,
  needEanCount,
  selectionSize,
  onClearSelection,
  onRemoveProduct,
  onRemoveVariant,
  connectionsLoading,
  connectionsError,
  onRetryConnections,
  eligibleDestinations,
  resolvedConnectionId,
  resolvedKind,
  onSelectConnection,
  canContinue,
  onContinue,
  onCancel,
  selectionSummary,
}: OfferProductPickerRailProps): ReactElement {
  return (
    <aside className="offer-product-picker__rail" aria-label="Selection">
      <div className="offer-product-picker__rail-head">
        <button
          ref={railBackRef}
          type="button"
          className="offer-product-picker__rail-back"
          aria-label="Back to products"
          onClick={onBack}
        >
          ‹
        </button>
        <div className="offer-product-picker__rail-titlebar">
          <span className="offer-product-picker__rail-title">In this batch</span>
          <Button
            tone="ghost"
            type="button"
            className="button--sm"
            disabled={selectionSize === 0}
            onClick={onClearSelection}
          >
            Clear all
          </Button>
        </div>
      </div>

      <div className="offer-product-picker__rail-counts">
        <div>
          <span className="offer-product-picker__rail-n tabular">{itemCount}</span>
          <span className="offer-product-picker__rail-lbl">
            {resolvedKind === 'shop' ? 'listings' : 'offers'}
          </span>
        </div>
        <div>
          <span className="offer-product-picker__rail-n tabular">{selectionSize}</span>
          <span className="offer-product-picker__rail-lbl">products</span>
        </div>
        <div>
          <span className="offer-product-picker__rail-n offer-product-picker__rail-n--warn tabular">
            {needEanCount}
          </span>
          <span className="offer-product-picker__rail-lbl">need EAN</span>
        </div>
      </div>

      <div className="offer-product-picker__rail-body">
        {railGroups.length === 0 ? (
          <p className="offer-product-picker__rail-empty">
            Nothing selected yet. Tick products or variants on the left.
          </p>
        ) : (
          railGroups.map((group) => {
            const isPartial =
              group.selected !== null && group.selected.length < group.totalVariants;
            return (
              <div className="offer-product-picker__selgrp" key={group.productId}>
                <div className="offer-product-picker__selgrp-head">
                  <ProductThumbnail name={group.name} src={group.imageSrc} size="sm" />
                  <b>{group.name}</b>
                  {group.whole ? (
                    group.wholeEan && !group.wholeEan.loaded ? (
                      <span className="bulk-chip bulk-chip--neutral">
                        <span className="bulk-chip__dot" />
                        not checked
                      </span>
                    ) : group.wholeEan && group.wholeEan.needCount > 0 ? (
                      <span className="bulk-chip bulk-chip--warning">
                        <span className="bulk-chip__dot" />
                        {group.wholeEan.needCount} need EAN
                      </span>
                    ) : (
                      <span className="bulk-chip bulk-chip--success">
                        <span className="bulk-chip__dot" />
                        ready
                      </span>
                    )
                  ) : isPartial ? (
                    <span className="bulk-chip bulk-chip--warning">
                      <span className="bulk-chip__dot" />
                      {group.selected!.length} of {group.totalVariants}
                    </span>
                  ) : (
                    <span className="bulk-chip bulk-chip--success">
                      <span className="bulk-chip__dot" />
                      ready
                    </span>
                  )}
                  <button
                    type="button"
                    className="offer-product-picker__rm"
                    aria-label={`Remove ${group.name}`}
                    onClick={() => onRemoveProduct(group.productId)}
                  >
                    ×
                  </button>
                </div>
                {group.whole ? (
                  <div className="offer-product-picker__seltag offer-product-picker__seltag--muted">
                    <span className="offer-product-picker__seltag-dot" />
                    Whole product · {group.totalVariants}{' '}
                    {group.totalVariants === 1 ? 'variant' : 'variants'}
                  </div>
                ) : (
                  group.selected!.map((variant) => (
                    <div className="offer-product-picker__seltag" key={variant.id}>
                      <span className="offer-product-picker__seltag-dot" />
                      {variant.label}
                      {variant.hasBarcode ? null : (
                        <span className="bulk-chip bulk-chip--warning">
                          <span className="bulk-chip__dot" />
                          no EAN
                        </span>
                      )}
                      <button
                        type="button"
                        className="offer-product-picker__rm offer-product-picker__rm--tag"
                        aria-label={`Remove ${variant.label}`}
                        onClick={() => onRemoveVariant(group.productId, variant.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="offer-product-picker__rail-foot">
        {connectionsLoading ? (
          <p className="muted-text">Loading destinations…</p>
        ) : connectionsError ? (
          <Alert
            tone="error"
            title="Unable to load connections"
            action={
              <Button tone="secondary" type="button" onClick={onRetryConnections}>
                Retry
              </Button>
            }
          >
            {connectionsError.message}
          </Alert>
        ) : eligibleDestinations.length === 0 ? (
          <Alert tone="warning" title="No publish destinations available">
            Add an active marketplace (offer creation) or online shop (product publishing)
            connection before publishing.
          </Alert>
        ) : (
          <div className="offer-product-picker__rail-conn">
            <span className="offer-product-picker__eyebrow" id="publishDestinationLabel">
              Publish to <span className="offer-product-picker__req">*</span>
            </span>
            <PublishDestinationRail
              destinations={eligibleDestinations}
              selectedConnectionId={resolvedConnectionId}
              onSelect={onSelectConnection}
              labelledBy="publishDestinationLabel"
            />
          </div>
        )}

        <p className="offer-product-picker__rail-summary" aria-live="polite">
          {selectionSummary}
        </p>

        <div className="offer-product-picker__rail-actions">
          <Button tone="ghost" type="button" onClick={onCancel}>
            Cancel
          </Button>
          {canContinue ? (
            <Button type="button" onClick={onContinue}>
              Continue →
            </Button>
          ) : (
            // Disabled buttons swallow hover, so the span is the tooltip
            // trigger and the button inside opts out of pointer events.
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="offer-product-picker__continue-wrap" tabIndex={0}>
                  <Button type="button" disabled>
                    Continue →
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {selectionSize === 0
                  ? 'Select at least one product, then choose a destination.'
                  : eligibleDestinations.length === 0
                    ? 'Add an active marketplace or shop connection before publishing.'
                    : 'Choose a destination to publish to first.'}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </aside>
  );
}
