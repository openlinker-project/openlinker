/**
 * Bundle composition (#3520)
 *
 * What a bundle row is made of when it publishes as ONE offer with several
 * products: each component with its thumbnail, quantity, a gift marker and how
 * it enters the set (its own live offer, a catalogue card, a new product, or not
 * at all). Shared by the Review row's expansion and the edit modal's section, so
 * the two cannot describe the same set differently.
 *
 * A component the destination cannot list says why in its own words, with a link
 * to publish that component on its own; the category the destination requires
 * (that of the first component's card) is offered as a one-click fix when the
 * offer is under a different one.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { interpolate, useMessages } from '../../../../shared/i18n';
import { StatusBadge, type StatusBadgeTone } from '../../../../shared/ui';
import { VariantThumbnail } from '../../../products';
import type { BundleComponentMode } from '../../api/listings.types';
import type { BundleOfferPreviewOk } from '../../hooks/use-bundle-offer-preview';

const MODE_TONE: Record<BundleComponentMode, StatusBadgeTone> = {
  'own-offer': 'success',
  'catalog-card': 'info',
  'new-product': 'neutral',
  missing: 'error',
};

/** Wizard URL that publishes one component on its own. */
export function publishComponentUrl(productId: string, connectionId: string): string {
  return `/listings/bulk-create/wizard?${new URLSearchParams({ productIds: productId, connectionId }).toString()}`;
}

interface BundleCompositionProps {
  preview: BundleOfferPreviewOk;
  connectionId: string;
  /** Category the offer would be submitted under; null when none is set. */
  chosenCategoryId: string | null;
  /** One-click fix for a category that differs from the first component's card. */
  onUseSuggestedCategory?: () => void;
  /** Heading above the list; omitted where the surrounding section already has one. */
  heading?: string;
}

export function BundleComposition({
  preview,
  connectionId,
  chosenCategoryId,
  onUseSuggestedCategory,
  heading,
}: BundleCompositionProps): ReactElement {
  const copy = useMessages('listings').bundleOffer;
  const mismatch =
    preview.suggestedCategoryId !== null &&
    chosenCategoryId !== null &&
    chosenCategoryId !== preview.suggestedCategoryId;

  return (
    <div className="bundle-comp" data-testid="bundle-composition">
      {heading ? <h4 className="bundle-comp__heading">{heading}</h4> : null}
      <ul className="bundle-comp__list">
        {preview.components.map((component) => {
          const modeLabel =
            component.mode === 'own-offer' && component.externalOfferId
              ? interpolate(copy.modes.ownOfferWithId, { id: component.externalOfferId })
              : copy.modes[
                  component.mode === 'own-offer'
                    ? 'ownOffer'
                    : component.mode === 'catalog-card'
                      ? 'catalogCard'
                      : component.mode === 'new-product'
                        ? 'newProduct'
                        : 'missing'
                ];
          return (
            <li key={component.variantId} className="bundle-comp__item" data-component={component.variantId}>
              <VariantThumbnail src={component.imageUrl} name={component.name} size="sm" />
              <div className="bundle-comp__text">
                <b className="bundle-comp__name">{component.name}</b>
                <small className="bundle-comp__meta">
                  {component.sku ? `${component.sku} · ` : ''}
                  {interpolate(copy.quantity, { n: component.quantity })}
                </small>
                {component.problems.map((problem) => (
                  <span key={problem.code} className="bundle-comp__problem">
                    {problem.message}
                  </span>
                ))}
              </div>
              <div className="bundle-comp__chips">
                {component.giftSlot ? <StatusBadge tone="review" compact>{copy.gift}</StatusBadge> : null}
                <StatusBadge tone={MODE_TONE[component.mode]} compact data-testid="bundle-mode">
                  {modeLabel}
                </StatusBadge>
                {component.mode === 'missing' ? (
                  <Link
                    className="bundle-comp__link"
                    to={publishComponentUrl(component.productId, connectionId)}
                  >
                    {copy.publishComponent}
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {mismatch && onUseSuggestedCategory ? (
        <div className="bundle-comp__category" data-testid="bundle-category-mismatch">
          <span>{copy.categoryMismatch}</span>
          <button type="button" className="bundle-comp__link" onClick={onUseSuggestedCategory}>
            {copy.useFirstComponentCategory}
          </button>
        </div>
      ) : null}
    </div>
  );
}
