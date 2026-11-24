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

import { interpolate, useMessages, usePlural } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ProductThumbnail } from '../../../shared/ui/product-thumbnail';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../shared/ui/tooltip';
import type { PublishDestination, PublishDestinationKind } from '../lib/publish-destinations';
import { PublishDestinationRail } from './publish-destination-rail';
import type { RailGroup } from './offer-product-picker.types';
import { describeApiError } from '../../../shared/api/describe-api-error';

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
  const copy = useMessages('listings').offerProductPickerRail;
  const plural = usePlural();
  return (
    <aside className="offer-product-picker__rail" aria-label={copy.ariaLabel}>
      <div className="offer-product-picker__rail-head">
        <button
          ref={railBackRef}
          type="button"
          className="offer-product-picker__rail-back"
          aria-label={copy.backAria}
          onClick={onBack}
        >
          ‹
        </button>
        <div className="offer-product-picker__rail-titlebar">
          <span className="offer-product-picker__rail-title">{copy.title}</span>
          <Button
            tone="ghost"
            type="button"
            className="button--sm"
            disabled={selectionSize === 0}
            onClick={onClearSelection}
          >
            {copy.clearAll}
          </Button>
        </div>
      </div>

      <div className="offer-product-picker__rail-counts">
        <div>
          <span className="offer-product-picker__rail-n tabular">{itemCount}</span>
          <span className="offer-product-picker__rail-lbl">
            {resolvedKind === 'shop' ? copy.counts.listings : copy.counts.offers}
          </span>
        </div>
        <div>
          <span className="offer-product-picker__rail-n tabular">{selectionSize}</span>
          <span className="offer-product-picker__rail-lbl">{copy.counts.products}</span>
        </div>
        <div>
          <span className="offer-product-picker__rail-n offer-product-picker__rail-n--warn tabular">
            {needEanCount}
          </span>
          <span className="offer-product-picker__rail-lbl">{copy.counts.needEan}</span>
        </div>
      </div>

      <div className="offer-product-picker__rail-body">
        {railGroups.length === 0 ? (
          <p className="offer-product-picker__rail-empty">
            {copy.empty}
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
                        {copy.chips.notChecked}
                      </span>
                    ) : group.wholeEan && group.wholeEan.needCount > 0 ? (
                      <span className="bulk-chip bulk-chip--warning">
                        <span className="bulk-chip__dot" />
                        {plural(group.wholeEan.needCount, copy.chips.needEan)}
                      </span>
                    ) : (
                      <span className="bulk-chip bulk-chip--success">
                        <span className="bulk-chip__dot" />
                        {copy.chips.ready}
                      </span>
                    )
                  ) : isPartial ? (
                    <span className="bulk-chip bulk-chip--warning">
                      <span className="bulk-chip__dot" />
                      {interpolate(copy.chips.partial, {
                        selected: group.selected!.length,
                        total: group.totalVariants,
                      })}
                    </span>
                  ) : (
                    <span className="bulk-chip bulk-chip--success">
                      <span className="bulk-chip__dot" />
                      {copy.chips.ready}
                    </span>
                  )}
                  <button
                    type="button"
                    className="offer-product-picker__rm"
                    aria-label={interpolate(copy.removeAria, { name: group.name })}
                    onClick={() => onRemoveProduct(group.productId)}
                  >
                    ×
                  </button>
                </div>
                {group.whole ? (
                  <div className="offer-product-picker__seltag offer-product-picker__seltag--muted">
                    <span className="offer-product-picker__seltag-dot" />
                    {plural(group.totalVariants, copy.wholeProduct)}
                  </div>
                ) : (
                  group.selected!.map((variant) => (
                    <div className="offer-product-picker__seltag" key={variant.id}>
                      <span className="offer-product-picker__seltag-dot" />
                      {variant.label}
                      {variant.hasBarcode ? null : (
                        <span className="bulk-chip bulk-chip--warning">
                          <span className="bulk-chip__dot" />
                          {copy.chips.noEan}
                        </span>
                      )}
                      <button
                        type="button"
                        className="offer-product-picker__rm offer-product-picker__rm--tag"
                        aria-label={interpolate(copy.removeAria, { name: variant.label })}
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
          <p className="muted-text">{copy.loadingDestinations}</p>
        ) : connectionsError ? (
          <Alert
            tone="error"
            title={copy.connectionsError}
            action={
              <Button tone="secondary" type="button" onClick={onRetryConnections}>
                {copy.retry}
              </Button>
            }
          >
            {describeApiError(connectionsError, 'listings')}
          </Alert>
        ) : eligibleDestinations.length === 0 ? (
          <Alert tone="warning" title={copy.noDestinations.title}>
            {copy.noDestinations.body}
          </Alert>
        ) : (
          <div className="offer-product-picker__rail-conn">
            <span className="offer-product-picker__eyebrow" id="publishDestinationLabel">
              {copy.publishTo} <span className="offer-product-picker__req">*</span>
            </span>
            <div className="offer-product-picker__rail-conn-list">
              <PublishDestinationRail
                destinations={eligibleDestinations}
                selectedConnectionId={resolvedConnectionId}
                onSelect={onSelectConnection}
                labelledBy="publishDestinationLabel"
              />
            </div>
          </div>
        )}

        <p className="offer-product-picker__rail-summary" aria-live="polite">
          {selectionSummary}
        </p>

        <div className="offer-product-picker__rail-actions">
          <Button tone="ghost" type="button" onClick={onCancel}>
            {copy.cancel}
          </Button>
          {canContinue ? (
            <Button type="button" onClick={onContinue}>
              {copy.continue} <span aria-hidden="true">→</span>
            </Button>
          ) : (
            // Disabled buttons swallow hover, so the span is the tooltip
            // trigger and the button inside opts out of pointer events.
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="offer-product-picker__continue-wrap" tabIndex={0}>
                  <Button type="button" disabled>
                    {copy.continue} <span aria-hidden="true">→</span>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {selectionSize === 0
                  ? copy.continueHint.noSelection
                  : eligibleDestinations.length === 0
                    ? copy.continueHint.noDestinations
                    : copy.continueHint.noDestination}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </aside>
  );
}
