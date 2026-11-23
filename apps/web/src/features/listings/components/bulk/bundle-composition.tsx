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
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';

import { interpolate, useMessages } from '../../../../shared/i18n';
import { StatusBadge, type StatusBadgeTone } from '../../../../shared/ui';
import { ENTRANCE_GROUP, ENTRANCE_ITEM } from '../../../../shared/ui/motion-presets';
import { packSizeOf } from './bundle-kind';
import { VariantThumbnail } from '../../../products';
import type { BundleComponentMode } from '../../api/listings.types';
import type { BundleOfferPreviewOk } from '../../hooks/use-bundle-offer-preview';

const MODE_COPY_KEY = {
  'own-offer': 'ownOffer',
  'catalog-card': 'catalogCard',
  'new-product': 'newProduct',
  missing: 'missing',
} as const satisfies Record<BundleComponentMode, string>;

const MODE_TONE: Record<BundleComponentMode, StatusBadgeTone> = {
  'own-offer': 'success',
  'catalog-card': 'info',
  'new-product': 'review',
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
  /** Marketplace display name, for the multipack explanation. */
  destinationName?: string;
  /** The "no EAN of its own" note; omitted where the surrounding section says it already. */
  showEanNote?: boolean;
}

export function BundleComposition({
  preview,
  connectionId,
  chosenCategoryId,
  onUseSuggestedCategory,
  heading,
  destinationName = '',
  showEanNote = false,
}: BundleCompositionProps): ReactElement {
  const copy = useMessages('listings').bundleOffer;
  const packSize = packSizeOf(preview);
  // The multipack rules below are Allegro's; another marketplace gets only the neutral line.
  const isAllegro = /allegro/i.test(destinationName);
  const limiting = preview.components.find(
    (component) => component.variantId === preview.limitingComponentVariantId,
  );
  const hasMissing = preview.components.some((component) => component.mode === 'missing');
  const mismatch =
    preview.suggestedCategoryId !== null &&
    chosenCategoryId !== null &&
    chosenCategoryId !== preview.suggestedCategoryId;

  // The card names no category and none was chosen: the row blocks on the same
  // sentence, so the panel and the row cannot disagree about what to fix.
  const cardWithoutCategory =
    preview.suggestedCategoryId === null &&
    !chosenCategoryId &&
    preview.components.some(
      (component) => component.mode === 'catalog-card' && !component.cardCategoryId,
    );

  return (
    <div className="bundle-comp" data-testid="bundle-composition">
      {heading ? (
        <div className="cx-h">
          <h3>{heading}</h3>
          <span className="pm-hint">
            {packSize !== null
              ? interpolate(copy.packCompositionHint, { n: packSize })
              : interpolate(copy.compositionHint, { n: preview.components.length })}
          </span>
        </div>
      ) : null}
      <p
        className={`bundle-comp__summary${preview.availableSets === 0 ? ' is-warn' : ''}`}
        data-testid="bundle-sets-summary"
      >
        <b>
          {preview.availableSets === null
            ? copy.setsSummaryUnknown
            : interpolate(copy.setsSummary, { n: preview.availableSets })}
        </b>
        {limiting ? (
          <span>{interpolate(copy.setsSummaryLimit, { name: limiting.name })}</span>
        ) : null}
      </p>
      {packSize !== null ? (
        <div className="bundle-comp__pack" data-testid="bundle-pack-hint">
          <p className="cx-sub">
            {interpolate(copy.packHint, { n: packSize, destination: destinationName })}
          </p>
          {isAllegro ? (
            <p className="cx-sub">{interpolate(copy.packHintAllegro, { n: packSize })}</p>
          ) : null}
          {preview.components[0] ? (
            <p className="cx-sub bundle-comp__buyer" data-testid="bundle-pack-buyer">
              <b>
                {interpolate(copy.packBuyerPreview, {
                  name: preview.components[0].name,
                  n: packSize,
                })}
              </b>
            </p>
          ) : null}
        </div>
      ) : null}
      <motion.ul
        className="cx-comp cx-wcomp bundle-comp__list"
        variants={ENTRANCE_GROUP}
        initial="hidden"
        animate="show"
      >
        {preview.components.map((component) => {
          const modeLabel =
            component.mode === 'own-offer' && component.externalOfferId
              ? interpolate(copy.modes.ownOfferWithId, { id: component.externalOfferId })
              : copy.modes[MODE_COPY_KEY[component.mode]];
          const modeHint = copy.modeHints[MODE_COPY_KEY[component.mode]];
          const isLimit = preview.limitingComponentVariantId === component.variantId;
          return (
            <motion.li
              variants={ENTRANCE_ITEM}
              key={component.variantId}
              className={`bundle-comp__item${component.mode === 'missing' ? ' is-bad' : ''}`}
              data-component={component.variantId}
            >
              <VariantThumbnail src={component.imageUrl} name={component.name} size="sm" />
              <span className="cx-comp__n">
                <span className="cx-comp__t">
                  <b className="bundle-comp__name" title={component.name}>
                    {component.name}
                  </b>
                  <span className="mono tabular cx-comp__x">
                    {interpolate(copy.quantity, { n: component.quantity })}
                  </span>
                  {component.giftSlot ? (
                    <span className="cx-tag cx-tag--gift">{copy.gift}</span>
                  ) : null}
                </span>
                <span className="cx-sub mono bundle-comp__meta">{component.sku ?? ''}</span>
                {component.availableUnits !== undefined && component.availableUnits !== null ? (
                  <span
                    className={`cx-sub tabular bundle-comp__stock${isLimit ? ' is-limit' : ''}`}
                    data-testid="bundle-component-stock"
                  >
                    {interpolate(copy.stockLine, {
                      units: component.availableUnits,
                      sets: Math.floor(component.availableUnits / Math.max(1, component.quantity)),
                    })}
                    {isLimit ? ` · ${copy.limitsSet}` : ''}
                  </span>
                ) : null}
                {component.problems.map((problem) => (
                  <span key={problem.code} className="bundle-comp__problem">
                    {problem.message}
                  </span>
                ))}
              </span>
              <span className="cx-wm">
                <span className="bundle-comp__mode" title={modeHint} tabIndex={0}>
                  <StatusBadge
                    tone={MODE_TONE[component.mode]}
                    compact
                    withDot
                    data-testid="bundle-mode"
                  >
                    {modeLabel}
                  </StatusBadge>
                  <span className="sr-only">{modeHint}</span>
                </span>
                {component.mode === 'missing' ? (
                  <Link
                    className="button button--secondary button--sm"
                    to={publishComponentUrl(component.productId, connectionId)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {copy.publishComponent}
                  </Link>
                ) : null}
              </span>
            </motion.li>
          );
        })}
      </motion.ul>
      {hasMissing ? (
        <p className="cx-sub bundle-comp__refresh" data-testid="bundle-missing-hint">
          {copy.missingHint}
        </p>
      ) : null}
      {showEanNote ? (
        <p className="cx-sub bundle-comp__ean">
          {packSize !== null ? copy.eanNotNeededPack : copy.eanNotNeeded}
        </p>
      ) : null}
      {cardWithoutCategory ? (
        <p className="cx-sub bundle-comp__category" data-testid="bundle-card-no-category">
          {copy.cardNoCategory}
        </p>
      ) : null}
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
